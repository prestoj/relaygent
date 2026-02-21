<script>
	let { form } = $props();
</script>

<svelte:head><title>Login — Relaygent</title></svelte:head>

<div class="card">
	<h1>Relaygent</h1>
	<p class="sub">Enter your password to continue.</p>
	{#if form?.incorrect}<p class="error">Incorrect password.</p>{/if}
	<form method="POST">
		<input type="password" name="password" placeholder="Password" required autofocus />
		<button type="submit">Log in</button>
	</form>
</div>

<style>
	.card {
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: 12px; padding: 2em 2.5em; width: 100%; max-width: 360px;
		box-shadow: 0 2px 12px rgba(0,0,0,0.08);
	}
	h1 { margin: 0 0 0.2em; font-size: 1.5em; text-align: center; }
	.sub { margin: 0 0 1.2em; color: var(--text-muted); font-size: 0.9em; text-align: center; }
	.error { color: var(--error); font-size: 0.85em; margin: 0 0 0.8em; text-align: center; }
	form { display: flex; flex-direction: column; gap: 0.75em; }
	input {
		padding: 0.6em 0.8em; border: 1px solid var(--border); border-radius: 6px;
		font-size: 1em; background: var(--bg); color: var(--text); outline: none;
	}
	input:focus { border-color: var(--link); box-shadow: 0 0 0 2px color-mix(in srgb, var(--link) 20%, transparent); }
	button {
		padding: 0.6em; background: var(--link); color: white; border: none;
		border-radius: 6px; font-size: 1em; font-weight: 600; cursor: pointer;
	}
	button:hover { opacity: 0.9; }
</style>
