import { json } from '@sveltejs/kit';
import { listSessions } from '$lib/relayActivity.js';

/** GET /api/sessions/stats — session summary for CLI stats command. */
export function GET() {
	const all = listSessions();
	const now = new Date();
	const todayStr = now.toISOString().slice(0, 10);
	const today = all.filter(s => s.displayTime?.startsWith(todayStr));

	const totalTokens = all.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
	const durations = all.map(s => s.durationMin).filter(d => d > 0);
	const avgDuration = durations.length
		? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

	const todayTokens = today.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
	const todayMin = today.reduce((sum, s) => sum + (s.durationMin || 0), 0);

	return json({
		total: all.length,
		today: {
			count: today.length,
			tokens: todayTokens,
			durationMin: todayMin,
			sessions: today.slice(0, 20).map(s => ({
				time: s.displayTime,
				durationMin: s.durationMin || 0,
				tokens: s.totalTokens || 0,
				tools: s.toolCalls || 0,
				summary: s.summary || null,
			})),
		},
		allTime: {
			tokens: totalTokens,
			avgDurationMin: avgDuration,
			firstSession: all.length ? all[all.length - 1].displayTime : null,
		},
	});
}
