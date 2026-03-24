<script>
	const COLS = 30, ROWS = 20, CELL = 18;
	let snake = $state([{r: 10, c: 15}]);
	let food = $state(spawnFood());
	let dir = $state({r: 0, c: 1});
	let nextDir = $state({r: 0, c: 1});
	let score = $state(0);
	let best = $state(0);
	let running = $state(false);
	let dead = $state(false);
	let timer = null;
	let speed = $state(120);

	function spawnFood() {
		let r, c;
		do { r = Math.floor(Math.random() * ROWS); c = Math.floor(Math.random() * COLS); }
		while (snake?.some(s => s.r === r && s.c === c));
		return {r, c};
	}

	function tick() {
		dir = nextDir;
		const head = {r: (snake[0].r + dir.r + ROWS) % ROWS, c: (snake[0].c + dir.c + COLS) % COLS};
		if (snake.some(s => s.r === head.r && s.c === head.c)) { die(); return; }
		snake = [head, ...snake];
		if (head.r === food.r && head.c === food.c) {
			score++;
			if (score > best) best = score;
			food = spawnFood();
			if (speed > 60) { speed -= 2; clearInterval(timer); timer = setInterval(tick, speed); }
		} else {
			snake = snake.slice(0, -1);
		}
	}

	function die() {
		running = false; dead = true; clearInterval(timer);
	}

	function start() {
		snake = [{r: 10, c: 15}]; food = spawnFood();
		dir = {r: 0, c: 1}; nextDir = {r: 0, c: 1};
		score = 0; dead = false; running = true; speed = 120;
		timer = setInterval(tick, speed);
	}

	function handleKey(e) {
		const moves = {ArrowUp: {r:-1,c:0}, ArrowDown: {r:1,c:0}, ArrowLeft: {r:0,c:-1}, ArrowRight: {r:0,c:1},
			w: {r:-1,c:0}, s: {r:1,c:0}, a: {r:0,c:-1}, d: {r:0,c:1}};
		const m = moves[e.key];
		if (m && !(m.r === -dir.r && m.c === -dir.c)) { nextDir = m; e.preventDefault(); }
		if (e.key === ' ' && !running) { start(); e.preventDefault(); }
	}

	function cellColor(r, c) {
		if (snake[0]?.r === r && snake[0]?.c === c) return 'var(--link)';
		if (snake.some(s => s.r === r && s.c === c)) return 'var(--success, #4a9)';
		if (food.r === r && food.c === c) return 'var(--error, #e55)';
		return 'var(--bg-surface)';
	}
</script>

<svelte:window onkeydown={handleKey} />
<svelte:head><title>Snake</title></svelte:head>

<div class="snake-page">
	<div class="header">
		<h1>Snake</h1>
		<span class="score">Score: {score} | Best: {best}</span>
	</div>
	<div class="controls">
		{#if running}
			<button onclick={() => { running = false; clearInterval(timer); }}>Pause</button>
		{:else if dead}
			<button onclick={start}>Play Again</button>
		{:else}
			<button onclick={start}>Play</button>
		{/if}
	</div>
	<svg viewBox="0 0 {COLS * CELL} {ROWS * CELL}" class="board"
		role="img" aria-label="Snake game grid">
		{#each Array(ROWS) as _, r}
			{#each Array(COLS) as _, c}
				<rect x={c * CELL + 0.5} y={r * CELL + 0.5} width={CELL - 1} height={CELL - 1}
					fill={cellColor(r, c)} rx="2" />
			{/each}
		{/each}
	</svg>
	{#if dead}
		<p class="game-over">Game Over! Score: {score}. Press Space or click Play Again.</p>
	{:else if !running}
		<p class="hint">Arrow keys or WASD to move. Press Space to start.</p>
	{:else}
		<p class="hint">Eat the red food. Don't hit yourself. Wraps around edges.</p>
	{/if}
</div>

<style>
	.snake-page { max-width: 560px; margin: 0 auto; }
	.header { display: flex; align-items: center; justify-content: space-between; }
	.header h1 { margin: 0; font-size: 1.3em; }
	.score { color: var(--text-muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
	.controls { display: flex; gap: 0.4em; margin: 0.5em 0; }
	.controls button {
		padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); color: var(--text); cursor: pointer; font-size: 0.85em;
	}
	.controls button:hover { border-color: var(--link); color: var(--link); }
	.board { width: 100%; border: 1px solid var(--border); border-radius: 6px; display: block;
		background: var(--bg); }
	.hint { color: var(--text-muted); font-size: 0.8em; margin-top: 0.4em; }
	.game-over { color: var(--error, #e55); font-size: 0.9em; margin-top: 0.4em; font-weight: 600; }
</style>
