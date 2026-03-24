<script>
	const SIZE = 4;
	let board = $state(newBoard());
	let score = $state(0);
	let best = $state(0);
	let gameOver = $state(false);
	let won = $state(false);

	function newBoard() {
		const b = Array.from({length: SIZE}, () => new Array(SIZE).fill(0));
		addTile(b); addTile(b);
		return b;
	}

	function addTile(b) {
		const empty = [];
		b.forEach((row, r) => row.forEach((v, c) => { if (!v) empty.push([r, c]); }));
		if (!empty.length) return;
		const [r, c] = empty[Math.floor(Math.random() * empty.length)];
		b[r][c] = Math.random() < 0.9 ? 2 : 4;
	}

	function slide(row) {
		const nums = row.filter(v => v);
		const merged = [];
		let pts = 0;
		for (let i = 0; i < nums.length; i++) {
			if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
				const val = nums[i] * 2;
				merged.push(val); pts += val; i++;
				if (val === 2048) won = true;
			} else merged.push(nums[i]);
		}
		while (merged.length < SIZE) merged.push(0);
		return { row: merged, pts };
	}

	function move(dir) {
		if (gameOver) return;
		const b = board.map(r => [...r]);
		let pts = 0, moved = false;
		const transform = (fn) => {
			for (let i = 0; i < SIZE; i++) {
				let row = fn(i, 'get');
				const {row: newRow, pts: p} = slide(row);
				pts += p;
				if (row.some((v, j) => v !== newRow[j])) moved = true;
				fn(i, 'set', newRow);
			}
		};
		if (dir === 'left') transform((i, op, v) => op === 'get' ? b[i] : (b[i] = v));
		else if (dir === 'right') transform((i, op, v) => op === 'get' ? [...b[i]].reverse() : (b[i] = v.reverse()));
		else if (dir === 'up') transform((i, op, v) => op === 'get' ? b.map(r => r[i]) : v.forEach((x, j) => b[j][i] = x));
		else if (dir === 'down') transform((i, op, v) => op === 'get' ? b.map(r => r[i]).reverse() : v.reverse().forEach((x, j) => b[j][i] = x));
		if (!moved) return;
		addTile(b);
		score += pts;
		if (score > best) best = score;
		board = b;
		if (!canMove()) gameOver = true;
	}

	function canMove() {
		for (let r = 0; r < SIZE; r++)
			for (let c = 0; c < SIZE; c++) {
				if (!board[r][c]) return true;
				if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return true;
				if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return true;
			}
		return false;
	}

	function restart() { board = newBoard(); score = 0; gameOver = false; won = false; }

	function handleKey(e) {
		const map = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',
			a:'left',d:'right',w:'up',s:'down'};
		if (map[e.key]) { move(map[e.key]); e.preventDefault(); }
	}

	const colors = {0:'var(--bg)',2:'#eee4da',4:'#ede0c8',8:'#f2b179',16:'#f59563',
		32:'#f67c5f',64:'#f65e3b',128:'#edcf72',256:'#edcc61',512:'#edc850',
		1024:'#edc53f',2048:'#edc22e'};
	const textColor = (v) => v <= 4 ? '#776e65' : '#f9f6f2';
	const fontSize = (v) => v >= 1024 ? '1.4em' : v >= 128 ? '1.6em' : '1.9em';
</script>

<svelte:window onkeydown={handleKey} />
<svelte:head><title>2048</title></svelte:head>

<div class="game-page">
	<div class="header">
		<h1>2048</h1>
		<span class="score">Score: {score} | Best: {best}</span>
	</div>
	<div class="controls">
		<button onclick={restart}>{gameOver ? 'Try Again' : 'New Game'}</button>
	</div>
	<div class="board">
		{#each board as row, r}
			{#each row as cell, c}
				<div class="cell" style="background:{colors[cell] || '#3c3a32'};color:{textColor(cell)};font-size:{fontSize(cell)}">
					{cell || ''}
				</div>
			{/each}
		{/each}
	</div>
	{#if gameOver}
		<p class="game-over">Game Over! Final score: {score}</p>
	{:else if won}
		<p class="win">You reached 2048! Keep going or start a new game.</p>
	{:else}
		<p class="hint">Arrow keys or WASD to slide tiles. Merge equal numbers!</p>
	{/if}
</div>

<style>
	.game-page { max-width: 420px; margin: 0 auto; }
	.header { display: flex; align-items: center; justify-content: space-between; }
	.header h1 { margin: 0; font-size: 1.3em; }
	.score { color: var(--text-muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
	.controls { display: flex; gap: 0.4em; margin: 0.5em 0; }
	.controls button {
		padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); color: var(--text); cursor: pointer; font-size: 0.85em;
	}
	.controls button:hover { border-color: var(--link); color: var(--link); }
	.board {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
		background: #bbada0; padding: 8px; border-radius: 8px;
	}
	.cell {
		aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
		border-radius: 4px; font-weight: 700; font-family: inherit;
		transition: background 0.1s;
	}
	.hint { color: var(--text-muted); font-size: 0.8em; margin-top: 0.4em; }
	.game-over { color: var(--error, #e55); font-size: 0.9em; margin-top: 0.4em; font-weight: 600; }
	.win { color: var(--success, #4a9); font-size: 0.9em; margin-top: 0.4em; font-weight: 600; }
</style>
