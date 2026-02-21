<script>
	import { onMount, onDestroy } from 'svelte';
	import { toNativeCoords, sendScreenAction, buildKeyAction } from '$lib/screenInteraction.js';

	let { fps = 10 } = $props();
	let imgEl = $state(null);
	let frameEl = $state(null);
	let online = $state(false);
	let everLoaded = $state(false);
	let interactive = $state(false);
	let lastAction = $state('');
	let interval = null;
	let pending = false;
	let dragState = null;
	let justDragged = false;
	let nativeWidth = 0;

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

	async function doAction(body, label) {
		lastAction = label;
		const res = await sendScreenAction(body);
		if (!res.ok) lastAction = `Error: ${res.error}`;
		setTimeout(refresh, 150);
	}

	function coords(e) { return toNativeCoords(e, imgEl, nativeWidth); }

	function handleMouseDown(e) {
		if (!interactive || !imgEl || e.button !== 0) return;
		const { x, y } = coords(e);
		dragState = { startX: x, startY: y, moved: false };
	}

	function handleMouseMove(e) {
		if (!dragState) return;
		const { x, y } = coords(e);
		if (Math.abs(x - dragState.startX) > 5 || Math.abs(y - dragState.startY) > 5) dragState.moved = true;
	}

	function handleMouseUp(e) {
		if (!dragState) return;
		if (dragState.moved) {
			justDragged = true;
			const { x, y } = coords(e);
			doAction({ action: 'drag', startX: dragState.startX, startY: dragState.startY, endX: x, endY: y },
				`drag ${dragState.startX},${dragState.startY} → ${x},${y}`);
			setTimeout(() => { justDragged = false; }, 100);
		}
		dragState = null;
	}

	function handleClick(e) {
		if (!interactive || !imgEl || justDragged) return;
		e.preventDefault();
		const { x, y } = coords(e);
		doAction({ action: 'click', x, y }, `click ${x},${y}`);
	}

	function handleDblClick(e) {
		if (!interactive || !imgEl) return;
		e.preventDefault();
		const { x, y } = coords(e);
		doAction({ action: 'click', x, y, double: true }, `dblclick ${x},${y}`);
	}

	function handleContextMenu(e) {
		if (!interactive) return;
		e.preventDefault();
		if (!imgEl) return;
		const { x, y } = coords(e);
		doAction({ action: 'click', x, y, right: true }, `right-click ${x},${y}`);
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
		doAction({ action: 'scroll', x, y, direction: dir, amount: 3 }, `scroll ${dir} at ${x},${y}`);
	}

	function handlePaste(e) {
		if (!interactive) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text');
		if (text) doAction({ action: 'type', text }, `paste (${text.length} chars)`);
	}

	onMount(() => { refresh(); interval = setInterval(refresh, 1000 / fps); });
	onDestroy(() => { if (interval) clearInterval(interval); });
</script>

<div class="stream">
	<div class="stream-header">
		<span class="dot" class:ok={online}></span>
		<span class="stream-label">Screen</span>
		<button class="ctrl-btn" class:active={interactive}
			onclick={() => { interactive = !interactive; if (interactive && frameEl) frameEl.focus(); }}>
			{interactive ? 'Interactive' : 'View Only'}
		</button>
		{#if lastAction}<span class="last-action">{lastAction}</span>{/if}
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="frame" class:interactive bind:this={frameEl} tabindex={interactive ? 0 : -1}
		onkeydown={handleKeyDown} onwheel={handleScroll} onpaste={handlePaste}
		onmousedown={handleMouseDown} onmousemove={handleMouseMove} onmouseup={handleMouseUp}>
		{#if !everLoaded}<div class="placeholder">Connecting...</div>{/if}
		<img bind:this={imgEl} alt="Screen" style="display:{everLoaded ? 'block' : 'none'}"
			onclick={handleClick} ondblclick={handleDblClick} oncontextmenu={handleContextMenu}
			draggable="false" />
	</div>
</div>

<style>
	.stream { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
	.stream-header { display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.6em; border-bottom: 1px solid var(--border); }
	.stream-label { font-weight: 600; font-size: 0.8em; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--error); flex-shrink: 0; }
	.dot.ok { background: var(--success); }
	.frame { position: relative; background: #111; overflow: hidden; outline: none; }
	.frame.interactive { cursor: default; outline: 2px solid #3b82f6; outline-offset: -2px; }
	.frame img { width: 100%; height: auto; display: block; user-select: none; -webkit-user-drag: none; }
	.placeholder { padding: 4em; text-align: center; color: #888; font-size: 0.85em; }
	.ctrl-btn { margin-left: auto; font-size: 0.72em; padding: 0.15em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-weight: 600; }
	.ctrl-btn:hover { border-color: var(--text-muted); color: var(--text); }
	.ctrl-btn.active { background: #dbeafe; color: #2563eb; border-color: #93c5fd; }
	.last-action { font-size: 0.68em; color: var(--text-muted); font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
