<script>
	const K = 5, W = 600, H = 200, PAD = 30;
	let arms = $state(genArms());
	let algos = $state(initAlgos());
	let round = $state(0);
	let running = $state(false);
	let timer = null;
	let speed = $state(10);

	function genArms() { return Array.from({length: K}, () => +(Math.random() * 0.9 + 0.05).toFixed(3)); }
	function bestMean() { return Math.max(...arms); }

	function initAlgos() {
		return ['Eps-Greedy', 'UCB1', 'ETC'].map(name => ({
			name, rewards: new Float64Array(K), counts: new Float64Array(K),
			regret: [0], total: 0, color: name === 'Eps-Greedy' ? '#f59e0b' : name === 'UCB1' ? '#3b82f6' : '#22c55e'
		}));
	}

	function pull(armIdx) { return Math.random() < arms[armIdx] ? 1 : 0; }
	function mean(a, i) { return a.counts[i] > 0 ? a.rewards[i] / a.counts[i] : 0; }

	function pickEpsGreedy(a, t) {
		const eps = Math.min(1, 5 * K / (t + 1));
		if (Math.random() < eps) return Math.floor(Math.random() * K);
		let best = 0;
		for (let i = 1; i < K; i++) if (mean(a, i) > mean(a, best)) best = i;
		return best;
	}

	function pickUCB(a, t) {
		for (let i = 0; i < K; i++) if (a.counts[i] === 0) return i;
		let best = 0, bestVal = -Infinity;
		for (let i = 0; i < K; i++) {
			const v = mean(a, i) + Math.sqrt(2 * Math.log(t) / a.counts[i]);
			if (v > bestVal) { bestVal = v; best = i; }
		}
		return best;
	}

	function pickETC(a, t) {
		const m = Math.ceil(Math.max(1, Math.pow(t / K, 2/3)));
		const phase = Math.floor(t / K);
		if (phase < m) return t % K;
		let best = 0;
		for (let i = 1; i < K; i++) if (mean(a, i) > mean(a, best)) best = i;
		return best;
	}

	const pickers = [pickEpsGreedy, pickUCB, pickETC];

	function step() {
		round++;
		const mu = bestMean();
		algos = algos.map((a, idx) => {
			const arm = pickers[idx](a, round);
			const r = pull(arm);
			a.rewards[arm] += r;
			a.counts[arm] += 1;
			a.total += r;
			const inst = mu - arms[arm];
			a.regret = [...a.regret, a.regret[a.regret.length - 1] + inst];
			return { ...a };
		});
	}

	function runN() { for (let i = 0; i < speed; i++) step(); }
	function play() { running = true; timer = setInterval(runN, 30); }
	function pause() { running = false; clearInterval(timer); }
	function reset() { pause(); round = 0; algos = initAlgos(); }
	function newProblem() { pause(); arms = genArms(); round = 0; algos = initAlgos(); }

	function regretPath(regArr) {
		if (regArr.length < 2) return '';
		const maxT = regArr.length - 1;
		const maxR = Math.max(1, ...algos.flatMap(a => a.regret));
		const sx = (W - 2 * PAD) / Math.max(1, maxT);
		const sy = (H - 2 * PAD) / maxR;
		const step = Math.max(1, Math.floor(regArr.length / 300));
		let d = `M${PAD},${H - PAD - regArr[0] * sy}`;
		for (let i = step; i < regArr.length; i += step)
			d += `L${PAD + i * sx},${H - PAD - regArr[i] * sy}`;
		if ((regArr.length - 1) % step !== 0)
			d += `L${PAD + maxT * sx},${H - PAD - regArr[maxT] * sy}`;
		return d;
	}

	function yTicks() {
		const maxR = Math.max(1, ...algos.flatMap(a => a.regret));
		const step = Math.pow(10, Math.floor(Math.log10(maxR || 1)));
		const ticks = [];
		for (let v = 0; v <= maxR; v += step) ticks.push(v);
		return ticks.slice(0, 6);
	}
</script>

<svelte:head><title>Bandits</title></svelte:head>

<div class="page">
	<div class="header">
		<h1>Multi-Armed Bandits</h1>
		<span class="round">Round {round}</span>
	</div>
	<div class="controls">
		{#if running}<button onclick={pause}>Pause</button>
		{:else}<button onclick={play}>Play</button>{/if}
		<button onclick={() => { step(); algos = algos; }} disabled={running}>Step</button>
		<button onclick={reset}>Reset</button>
		<button onclick={newProblem}>New Arms</button>
		<label class="speed">Speed <input type="range" min="1" max="100" bind:value={speed}> {speed}x</label>
	</div>

	<div class="arms">
		{#each arms as mu, i}
			<div class="arm">
				<div class="arm-bar" style="height: {mu * 40}px; background: {i === arms.indexOf(bestMean()) ? 'var(--link)' : 'var(--text-muted)'}"></div>
				<span class="arm-label">{mu.toFixed(2)}</span>
			</div>
		{/each}
		<span class="arm-hint">True means (hidden from algorithms)</span>
	</div>

	<svg viewBox="0 0 {W} {H}" class="chart">
		<line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" />
		<line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border)" />
		{#each yTicks() as v}
			{@const maxR = Math.max(1, ...algos.flatMap(a => a.regret))}
			{@const y = H - PAD - v * (H - 2 * PAD) / maxR}
			<text x={PAD - 4} {y} fill="var(--text-muted)" font-size="9" text-anchor="end" dominant-baseline="middle">{Math.round(v)}</text>
		{/each}
		<text x={W / 2} y={H - 4} fill="var(--text-muted)" font-size="10" text-anchor="middle">Rounds</text>
		<text x={8} y={H / 2} fill="var(--text-muted)" font-size="10" text-anchor="middle" transform="rotate(-90 8 {H/2})">Regret</text>
		{#each algos as a}
			<path d={regretPath(a.regret)} fill="none" stroke={a.color} stroke-width="2" />
		{/each}
	</svg>

	<div class="legend">
		{#each algos as a}
			<span class="lg"><span class="dot" style="background:{a.color}"></span>{a.name}: regret {a.regret[a.regret.length - 1].toFixed(1)}</span>
		{/each}
	</div>

	<div class="pulls">
		<h3>Arm Pulls</h3>
		<table>
			<thead><tr><th>Algo</th><th>Arm 1</th><th>Arm 2</th><th>Arm 3</th><th>Arm 4</th><th>Arm 5</th></tr></thead>
			<tbody>{#each algos as a}
				<tr style="color:{a.color}"><td>{a.name}</td><td>{a.counts[0]}</td><td>{a.counts[1]}</td><td>{a.counts[2]}</td><td>{a.counts[3]}</td><td>{a.counts[4]}</td></tr>
			{/each}</tbody>
		</table>
	</div>
	<p class="hint">Bernoulli arms. Eps-Greedy uses decaying epsilon (5K/t). UCB1 with ln(t) exploration. ETC explores ceil(t/K)^(2/3) rounds per arm then commits.</p>
</div>

<style>
	.page { max-width: 660px; margin: 0 auto; padding: 0 1em; }
	.header { display: flex; align-items: center; justify-content: space-between; }
	.header h1 { margin: 0; font-size: 1.3em; }
	.round { color: var(--text-muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
	.controls { display: flex; gap: 0.4em; margin: 0.5em 0; flex-wrap: wrap; align-items: center; }
	.controls button {
		padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); color: var(--text); cursor: pointer; font-size: 0.85em;
	}
	.controls button:hover { border-color: var(--link); color: var(--link); }
	.controls button:disabled { opacity: 0.4; cursor: default; }
	.speed { font-size: 0.8em; color: var(--text-muted); display: flex; align-items: center; gap: 0.3em; margin-left: auto; }
	.speed input { width: 80px; }
	.arms { display: flex; gap: 0.5em; align-items: flex-end; padding: 0.5em 0; position: relative; }
	.arm { display: flex; flex-direction: column; align-items: center; gap: 0.2em; }
	.arm-bar { width: 32px; border-radius: 4px 4px 0 0; min-height: 2px; transition: height 0.3s; }
	.arm-label { font-size: 0.75em; color: var(--text-muted); font-variant-numeric: tabular-nums; }
	.arm-hint { position: absolute; right: 0; bottom: 0; font-size: 0.7em; color: var(--text-muted); }
	.chart { width: 100%; border: 1px solid var(--border); border-radius: 6px; display: block; margin: 0.5em 0; }
	.legend { display: flex; gap: 1em; font-size: 0.8em; flex-wrap: wrap; }
	.lg { display: flex; align-items: center; gap: 0.3em; font-variant-numeric: tabular-nums; }
	.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
	.pulls { margin: 0.8em 0; }
	.pulls h3 { margin: 0 0 0.3em; font-size: 0.9em; }
	.pulls table { font-size: 0.8em; border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
	.pulls th, .pulls td { padding: 0.2em 0.5em; border-bottom: 1px solid var(--border); text-align: center; }
	.pulls th { color: var(--text-muted); font-weight: 500; }
	.hint { color: var(--text-muted); font-size: 0.75em; margin-top: 0.5em; }
</style>
