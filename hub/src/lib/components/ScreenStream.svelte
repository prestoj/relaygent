<script>
	import { onMount, onDestroy } from 'svelte';
	import { toNativeCoords, sendScreenAction, buildKeyAction, mouseModifiers, scrollAmount } from '$lib/screenInteraction.js';

	let { fps = 10, startInteractive = false } = $props();
	let imgEl = $state(null);
	let frameEl = $state(null);
	let online = $state(false);
	let everLoaded = $state(false);
	let interactive = $state(startInteractive);
	let lastAction = $state('');
	let cursorPos = $state(null);
	let interval = null;
	let pending = false;
	let dragState = null;
	let nativeWidth = 0;
	let lastInteraction = 0;
	let lastClickTime = 0;
	let lastClickX = 0;
	let lastClickY = 0;
	let lastHoverSent = 0;
	const HOVER_THROTTLE = 80;
	const ACTIVE_FPS = 30;
	const IDLE_FPS = 5;
	const IDLE_AFTER = 2000;

	function currentFps() {
		if (!interactive) return fps;
		return (Date.now() - lastInteraction < IDLE_AFTER) ? ACTIVE_FPS : IDLE_FPS;
	}

	function refresh() {
		if (!imgEl || pending) return;
		pending = true;
		fetch(`/api/screen?t=${Date.now()}`)
			.then(res => {
				const w = parseInt(res.headers.get('X-Native-Width') || '0', 10);
				if (w > 0) nativeWidth = w;
				return res.blob();
			})
			.then(blob => {
				imgEl.src = URL.createObjectURL(blob);
				online = true; everLoaded = true; pending = false;
			})
			.catch(() => { online = false; pending = false; });
	}

	function tick() {
		refresh();
		interval = setTimeout(tick, 1000 / currentFps());
	}
	function startLoop() { stopLoop(); tick(); }
	function stopLoop() { if (interval) { clearTimeout(interval); interval = null; } }

	async function doAction(body, label) {
		lastAction = label;
		lastInteraction = Date.now();
		const res = await sendScreenAction(body);
		if (!res.ok) lastAction = `Error: ${res.error}`;
		setTimeout(refresh, 150);
	}

	function coords(e) { return toNativeCoords(e, imgEl, nativeWidth); }

	function handleMouseDown(e) {
		if (!interactive || !imgEl || e.button !== 0) return;
		e.preventDefault();
		dragState = { bx: e.clientX, by: e.clientY, moved: false, t: Date.now() };
	}

	function handleMouseMove(e) {
		if (!interactive || !imgEl) return;
		const rect = imgEl.getBoundingClientRect();
		cursorPos = { left: e.clientX - rect.left, top: e.clientY - rect.top };
		if (dragState) {
			if (Math.abs(e.clientX - dragState.bx) > 15 || Math.abs(e.clientY - dragState.by) > 15) dragState.moved = true;
			return;
		}
		const now = Date.now();
		if (now - lastHoverSent < HOVER_THROTTLE) return;
		lastHoverSent = now;
		const { x, y } = coords(e);
		lastInteraction = now;
		sendScreenAction({ action: 'mouse_move', x, y });
	}

	function handleMouseUp(e) {
		if (!interactive || !imgEl || e.button !== 0 || !dragState) { dragState = null; return; }
		const isDrag = dragState.moved && (Date.now() - dragState.t) > 300;
		if (isDrag) {
			const start = toNativeCoords({ clientX: dragState.bx, clientY: dragState.by }, imgEl, nativeWidth);
			const end = coords(e);
			doAction({ action: 'drag', startX: start.x, startY: start.y, endX: end.x, endY: end.y },
				`drag ${start.x},${start.y} → ${end.x},${end.y}`);
			dragState = null; return;
		}
		dragState = null;
		const { x, y } = coords(e);
		const now = Date.now();
		const isDbl = (now - lastClickTime < 400) &&
			Math.abs(x - lastClickX) < 20 && Math.abs(y - lastClickY) < 20;
		if (isDbl) {
			doAction({ action: 'click', x, y, double: true, modifiers: mouseModifiers(e) }, `dblclick ${x},${y}`);
			lastClickTime = 0;
		} else {
			doAction({ action: 'click', x, y, modifiers: mouseModifiers(e) }, `click ${x},${y}`);
			lastClickTime = now; lastClickX = x; lastClickY = y;
		}
	}

	function handleContextMenu(e) {
		if (!interactive) return;
		e.preventDefault();
		if (!imgEl) return;
		const { x, y } = coords(e);
		doAction({ action: 'click', x, y, right: true, modifiers: mouseModifiers(e) }, `right-click ${x},${y}`);
	}

	function handleAuxClick(e) {
		if (!interactive || !imgEl || e.button !== 1) return;
		e.preventDefault();
		const { x, y } = coords(e);
		doAction({ action: 'click', x, y, middle: true }, `middle-click ${x},${y}`);
	}

	function handleKeyDown(e) {
		if (!interactive) return;
		e.preventDefault();
		const action = buildKeyAction(e);
		if (action) doAction(action.body, action.label);
	}

	function handleScroll(e) {
		if (!interactive || !imgEl) return;
		e.preventDefault();
		const { x, y } = coords(e);
		const dir = e.deltaY > 0 ? 'down' : 'up';
		doAction({ action: 'scroll', x, y, direction: dir, amount: scrollAmount(e.deltaY) }, `scroll ${dir} at ${x},${y}`);
	}

	function handlePaste(e) {
		if (!interactive) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text');
		if (text) doAction({ action: 'type', text }, `paste (${text.length} chars)`);
	}

	function toggleFs() { document.fullscreenElement ? document.exitFullscreen() : frameEl?.requestFullscreen(); }

	onMount(() => { refresh(); startLoop(); if (startInteractive && frameEl) frameEl.focus(); });
	onDestroy(stopLoop);
</script>

<div class="stream">
	<div class="stream-header">
		<span class="dot" class:ok={online}></span>
		<span class="stream-label">Screen</span>
		<button class="ctrl-btn" class:active={interactive}
			onclick={() => { interactive = !interactive; if (interactive && frameEl) frameEl.focus(); }}>
			{interactive ? 'Interactive' : 'View Only'}
		</button>
		<button class="ctrl-btn" onclick={toggleFs} title="Fullscreen">&#x26F6;</button>
		{#if lastAction}<span class="last-action">{lastAction}</span>{/if}
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="frame" class:interactive bind:this={frameEl} tabindex={interactive ? 0 : -1}
		onkeydown={handleKeyDown} onwheel={handleScroll} onpaste={handlePaste}
		onmousedown={handleMouseDown} onmousemove={handleMouseMove} onmouseup={handleMouseUp}
		onmouseleave={() => { cursorPos = null; dragState = null; }}>
		{#if !everLoaded}<div class="placeholder">Connecting...</div>{/if}
		<img bind:this={imgEl} alt="Screen" style="display:{everLoaded ? 'block' : 'none'}"
			oncontextmenu={handleContextMenu} onauxclick={handleAuxClick} draggable="false" />
		{#if interactive && cursorPos}
			<div class="crosshair" style="left:{cursorPos.left}px;top:{cursorPos.top}px"></div>
		{/if}
	</div>
</div>

<style>
	.stream { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
	.stream-header { display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.6em; border-bottom: 1px solid var(--border); }
	.stream-label { font-weight: 600; font-size: 0.8em; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--error); flex-shrink: 0; }
	.dot.ok { background: var(--success); }
	.frame { position: relative; background: #111; overflow: hidden; outline: none; }
	.frame.interactive { cursor: none; outline: 2px solid #3b82f6; outline-offset: -2px; }
	.frame img { width: 100%; height: auto; display: block; user-select: none; -webkit-user-drag: none; }
	.placeholder { padding: 4em; text-align: center; color: #888; font-size: 0.85em; }
	.ctrl-btn { margin-left: auto; font-size: 0.72em; padding: 0.15em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-weight: 600; }
	.ctrl-btn:hover { border-color: var(--text-muted); color: var(--text); }
	.ctrl-btn.active { background: #dbeafe; color: #2563eb; border-color: #93c5fd; }
	.frame:fullscreen { display: flex; align-items: center; justify-content: center; background: #000; }
	.frame:fullscreen img { width: auto; max-width: 100vw; max-height: 100vh; }
	.crosshair { position: absolute; width: 12px; height: 12px; pointer-events: none; transform: translate(-50%, -50%); border: 1.5px solid rgba(255,50,50,0.9); border-radius: 50%; box-shadow: 0 0 4px rgba(255,50,50,0.5), 0 0 0 1px rgba(0,0,0,0.3); }
	.last-action { font-size: 0.68em; color: var(--text-muted); font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
