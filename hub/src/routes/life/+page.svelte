<script>
	const COLS = 60, ROWS = 40, CELL = 10;
	let grid = $state(makeGrid());
	let running = $state(false);
	let gen = $state(0);
	let timer = null;

	function makeGrid() { return Array.from({length: ROWS}, () => new Array(COLS).fill(false)); }

	function countNeighbors(g, r, c) {
		let n = 0;
		for (let dr = -1; dr <= 1; dr++)
			for (let dc = -1; dc <= 1; dc++) {
				if (!dr && !dc) continue;
				const nr = (r + dr + ROWS) % ROWS, nc = (c + dc + COLS) % COLS;
				if (g[nr][nc]) n++;
			}
		return n;
	}

	function step() {
		grid = grid.map((row, r) => row.map((cell, c) => {
			const n = countNeighbors(grid, r, c);
			return cell ? (n === 2 || n === 3) : n === 3;
		}));
		gen++;
	}

	function toggle(r, c) { grid[r][c] = !grid[r][c]; grid = grid; }

	function play() { running = true; timer = setInterval(step, 100); }
	function pause() { running = false; clearInterval(timer); }
	function clear() { pause(); grid = makeGrid(); gen = 0; }

	function randomize() {
		pause();
		grid = grid.map(row => row.map(() => Math.random() < 0.3));
		gen = 0;
	}

	function addGlider(r0, c0) {
		const pts = [[0,1],[1,2],[2,0],[2,1],[2,2]];
		pts.forEach(([dr, dc]) => {
			const r = (r0 + dr) % ROWS, c = (c0 + dc) % COLS;
			grid[r][c] = true;
		});
		grid = grid;
	}
</script>

<svelte:head><title>Life</title></svelte:head>

<div class="life-page">
	<div class="header">
		<h1>Conway's Game of Life</h1>
		<span class="gen">Gen {gen}</span>
	</div>
	<div class="controls">
		{#if running}
			<button onclick={pause}>Pause</button>
		{:else}
			<button onclick={play}>Play</button>
		{/if}
		<button onclick={step} disabled={running}>Step</button>
		<button onclick={randomize}>Random</button>
		<button onclick={() => addGlider(2, 2)}>Glider</button>
		<button onclick={clear}>Clear</button>
	</div>
	<svg viewBox="0 0 {COLS * CELL} {ROWS * CELL}" class="board"
		role="img" aria-label="Game of Life grid">
		{#each grid as row, r}
			{#each row as cell, c}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect x={c * CELL} y={r * CELL} width={CELL - 1} height={CELL - 1}
					fill={cell ? 'var(--link)' : 'var(--bg-surface)'}
					onclick={() => toggle(r, c)} class="cell" />
			{/each}
		{/each}
	</svg>
	<p class="hint">Click cells to draw. Toroidal grid (wraps around).</p>
</div>

<style>
	.life-page { max-width: 620px; margin: 0 auto; }
	.header { display: flex; align-items: center; justify-content: space-between; }
	.header h1 { margin: 0; font-size: 1.3em; }
	.gen { color: var(--text-muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
	.controls { display: flex; gap: 0.4em; margin: 0.5em 0; }
	.controls button {
		padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); color: var(--text); cursor: pointer; font-size: 0.85em;
	}
	.controls button:hover { border-color: var(--link); color: var(--link); }
	.controls button:disabled { opacity: 0.4; cursor: default; }
	.board { width: 100%; border: 1px solid var(--border); border-radius: 6px; display: block; }
	.cell { cursor: pointer; transition: fill 0.05s; }
	.cell:hover { opacity: 0.8; }
	.hint { color: var(--text-muted); font-size: 0.8em; margin-top: 0.4em; }
</style>
