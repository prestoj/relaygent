<script>
	let { data } = $props();

	// Compare against LOCAL today/yesterday (not toISOString/UTC), matching the
	// local-day grouping — otherwise evening entries label as "Yesterday".
	const localYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	function dayLabel(day) {
		const today = new Date(); const t = localYMD(today);
		const y = localYMD(new Date(today.getTime() - 86400000));
		if (day === t) return 'Today';
		if (day === y) return 'Yesterday';
		// day is YYYY-MM-DD — render as "Mon DD" without TZ shift
		const [yr, mo, dd] = day.split('-').map(Number);
		const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		return `${MON[mo - 1]} ${dd}${yr !== today.getFullYear() ? ', ' + yr : ''}`;
	}
	const time = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
	// Linkify a bare "#744" or a full URL.
	function href(link) {
		if (!link) return '';
		if (/^https?:\/\//.test(link)) return link;
		const m = link.match(/^#?(\d+)$/);
		if (m) return `https://github.com/prestoj/relaygent/pull/${m[1]}`;
		return '';
	}
</script>

<svelte:head><title>Relaygent · Worklog</title></svelte:head>

<div class="worklog">
	<header>
		<h1>Worklog</h1>
		<span class="sub">{data.total} logged · shipped from {data.hostname}</span>
	</header>

	{#if data.groups.length === 0}
		<p class="empty">Nothing logged yet.</p>
	{:else}
		{#each data.groups as g (g.day)}
			<section class="day">
				<h2>{dayLabel(g.day)} <span class="count">{g.entries.length}</span></h2>
				<ul>
					{#each g.entries as e}
						<li>
							<span class="dot"></span>
							<div class="body">
								<div class="line">
									<span class="title">{e.title}</span>
									{#if href(e.link)}<a class="link" href={href(e.link)} target="_blank" rel="noreferrer">{e.link.startsWith('#') || /^\d+$/.test(e.link) ? `#${e.link.replace('#','')}` : 'link'}</a>{/if}
									{#if e.kind}<span class="tag">{e.kind}</span>{/if}
									<span class="time">{time(e.ts)}</span>
								</div>
								{#if e.detail}<div class="detail">{e.detail}</div>{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<style>
	.worklog { max-width: 820px; }
	header { display: flex; align-items: baseline; gap: 0.75em; margin-bottom: 1.5em; flex-wrap: wrap; }
	h1 { margin: 0; font-size: 1.5em; }
	.sub { color: var(--text-muted); font-size: 0.85em; }
	.empty { color: var(--text-muted); }
	.day { margin-bottom: 1.6em; }
	.day h2 {
		font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);
		margin: 0 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border);
	}
	.day h2 .count { color: var(--text-muted); opacity: 0.6; font-weight: 400; margin-left: 0.3em; }
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; gap: 0.7em; padding: 0.5em 0; align-items: flex-start; }
	.dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; margin-top: 0.55em; background: var(--border); }
	.body { min-width: 0; flex: 1; }
	.line { display: flex; align-items: baseline; gap: 0.55em; flex-wrap: wrap; }
	.title { color: var(--text); font-weight: 500; }
	.link { font-family: monospace; font-size: 0.85em; }
	.tag { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 0.05em 0.4em; }
	.time { color: var(--text-muted); font-size: 0.78em; margin-left: auto; white-space: nowrap; }
	.detail { color: var(--text-muted); font-size: 0.88em; margin-top: 0.2em; line-height: 1.45; overflow-wrap: anywhere; }
</style>
