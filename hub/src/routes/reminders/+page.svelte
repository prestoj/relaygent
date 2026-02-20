<script>
	import Reminders from '$lib/components/Reminders.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Reminders</title></svelte:head>

<h2>Reminders</h2>
<Reminders initial={data.reminders} />
