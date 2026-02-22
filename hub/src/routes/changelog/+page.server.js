export async function load({ fetch, url }) {
	const days = url.searchParams.get('days') || '7';
	try {
		const res = await fetch(`/api/changelog?days=${days}`);
		const data = await res.json();
		return { ...data, days: parseInt(days) };
	} catch { return { prs: [], commits: 0, days: parseInt(days) }; }
}
