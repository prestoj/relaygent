import { json } from '@sveltejs/kit';
import { listSessions } from '$lib/relayActivity.js';

// Pricing per million tokens (USD)
const PRICING = {
	opus:   { input: 15.0,  output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
	sonnet: { input: 3.0,   output: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },
	haiku:  { input: 0.80,  output: 4.0,  cacheWrite: 1.0,   cacheRead: 0.08 },
};
const M = 1_000_000;

function modelTier(name) {
	if (!name) return 'sonnet';
	const n = name.toLowerCase();
	if (n.includes('opus')) return 'opus';
	if (n.includes('haiku')) return 'haiku';
	return 'sonnet';
}

function sessionCost(s) {
	const rates = PRICING[modelTier(s.model)] || PRICING.sonnet;
	return ((s.inputTokens || 0) * rates.input + (s.cacheWriteTokens || 0) * rates.cacheWrite
		+ (s.cacheReadTokens || 0) * rates.cacheRead + (s.outputTokens || 0) * rates.output) / M;
}

/** GET /api/cost?days=7 */
export function GET({ url }) {
	const days = parseInt(url.searchParams.get('days') || '7') || 7;
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);
	const cutoffStr = cutoff.toISOString().slice(0, 10);

	const all = listSessions();
	const recent = all.filter(s => s.displayTime >= cutoffStr);

	let totalCost = 0;
	const byTier = {};
	const perDay = {};

	for (const s of recent) {
		const tier = modelTier(s.model);
		const cost = sessionCost(s);
		totalCost += cost;
		if (!byTier[tier]) byTier[tier] = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
		byTier[tier].input += s.inputTokens || 0;
		byTier[tier].cacheWrite += s.cacheWriteTokens || 0;
		byTier[tier].cacheRead += s.cacheReadTokens || 0;
		byTier[tier].output += s.outputTokens || 0;
		byTier[tier].cost += cost;
		const day = s.displayTime?.slice(0, 10);
		if (day) perDay[day] = (perDay[day] || 0) + cost;
	}

	// Round costs
	for (const t of Object.values(byTier)) t.cost = Math.round(t.cost * 100) / 100;

	return json({
		days, sessions: recent.length,
		cost: Math.round(totalCost * 100) / 100,
		byTier,
		perDay: Object.entries(perDay).sort().map(([date, cost]) => ({ date, cost: Math.round(cost * 100) / 100 })),
		pricing: PRICING,
	});
}
