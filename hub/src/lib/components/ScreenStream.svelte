<script>
	import { onMount, onDestroy } from 'svelte';

	let { fps = 10 } = $props();
	let imgEl = $state(null);
	let frameEl = $state(null);
	let online = $state(false);
	let everLoaded = $state(false);
	let interactive = $state(false);
	let lastAction = $state('');
	let interval = null;
	let pending = false;
	let dragState = null; // { startX, startY } when dragging

	function refresh() {
		if (!imgEl || pending) return;
		pending = true;
		const img = new Image();
		img.onload = () => { imgEl.src = img.src; online = true; everLoaded = true; pending = false; };
		img.onerror = () => { online = false; pending = false; };
		img.src = `/api/screen?t=${Date.now()}`;
	}

	function toNative(e) {
		const rect = imgEl.getBoundingClientRect();
		const scaleX = imgEl.naturalWidth / rect.width;
		const scaleY = imgEl.naturalHeight / rect.height;
		return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
	}

	async function sendAction(body) {
		try {
			const res = await fetch('/api/screen/action', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!res.ok) lastAction = `Error: ${(await res.json()).error}`;
			else lastAction = `${body.action} OK`;
		} catch { lastAction = 'Network error'; }
		setTimeout(refresh, 150);
	}

	function handleMouseDown(e) {
		if (!interactive || !imgEl || e.button !== 0) return;
		const { x, y } = toNative(e);
		dragState = { startX: x, startY: y, moved: false };
	}

	function handleMouseMove(e) {
		if (!dragState) return;
		const { x, y } = toNative(e);
		const dx = Math.abs(x - dragState.startX), dy = Math.abs(y - dragState.startY);
		if (dx > 5 || dy > 5) dragState.moved = true;
	}

	function handleMouseUp(e) {
		if (!dragState) return;
		if (dragState.moved) {
			const { x, y } = toNative(e);
			sendAction({ action: 'drag', startX: dragState.startX, startY: dragState.startY, endX: x, endY: y });
			lastAction = `drag ${dragState.startX},${dragState.startY} → ${x},${y}`;
		}
		dragState = null;
	}

	function handleClick(e) {
		if (!interactive || !imgEl) return;
		e.preventDefault();
		if (dragState?.moved) return; // drag handled in mouseup
		const { x, y } = toNative(e);
		const right = e.button === 2;
		sendAction({ action: 'click', x, y, right: right || undefined });
		lastAction = `click ${x},${y}${right ? ' (right)' : ''}`;
	}

	function handleDblClick(e) {
		if (!interactive || !imgEl) return;
		e.preventDefault();
		const { x, y } = toNative(e);
		sendAction({ action: 'click', x, y, double: true });
		lastAction = `dblclick ${x},${y}`;
	}

	function handleContextMenu(e) { if (interactive) e.preventDefault(); }

	function handleKeyDown(e) {
		if (!interactive) return;
		e.preventDefault();
		const modifiers = [];
		if (e.metaKey) modifiers.push('cmd');
		if (e.ctrlKey) modifiers.push('ctrl');
		if (e.altKey) modifiers.push('alt');
		if (e.shiftKey) modifiers.push('shift');
		const mods = modifiers.length ? modifiers : undefined;
		const named = KEY_MAP[e.key];
		if (named) {
			sendAction({ action: 'type', key: named, modifiers: mods });
			lastAction = `key: ${mods ? mods.join('+') + '+' : ''}${named}`;
		} else if (e.key.length === 1) {
			if (mods) {
				sendAction({ action: 'type', key: e.key, modifiers: mods });
				lastAction = `key: ${mods.join('+')}+${e.key}`;
			} else {
				sendAction({ action: 'type', text: e.key });
				lastAction = `type: "${e.key}"`;
			}
		}
	}

	function handleScroll(e) {
		if (!interactive || !imgEl) return;
		e.preventDefault();
		const { x, y } = toNative(e);
		const direction = e.deltaY > 0 ? 'down' : 'up';
		sendAction({ action: 'scroll', x, y, direction, amount: 3 });
		lastAction = `scroll ${direction} at ${x},${y}`;
	}

	const KEY_MAP = {
		Enter: 'return', Backspace: 'delete', Delete: 'forwarddelete', Tab: 'tab',
		Escape: 'escape', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left',
		ArrowRight: 'right', ' ': 'space', Home: 'home', End: 'end',
		PageUp: 'pageup', PageDown: 'pagedown',
	};

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
		onkeydown={handleKeyDown} onwheel={handleScroll}
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
	.dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; flex-shrink: 0; }
	.dot.ok { background: #22c55e; }
	.frame { position: relative; background: #111; overflow: hidden; outline: none; }
	.frame.interactive { cursor: crosshair; outline: 2px solid #3b82f6; outline-offset: -2px; }
	.frame img { width: 100%; height: auto; display: block; user-select: none; -webkit-user-drag: none; }
	.placeholder { padding: 4em; text-align: center; color: #888; font-size: 0.85em; }
	.ctrl-btn { margin-left: auto; font-size: 0.72em; padding: 0.15em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-weight: 600; }
	.ctrl-btn:hover { border-color: var(--text-muted); color: var(--text); }
	.ctrl-btn.active { background: #dbeafe; color: #2563eb; border-color: #93c5fd; }
	.last-action { font-size: 0.68em; color: var(--text-muted); font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
