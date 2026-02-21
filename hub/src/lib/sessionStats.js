import fs from 'fs';
import path from 'path';

// Per-file stats cache: avoids re-parsing unchanged JSONL files
const _statsCache = new Map(); // path → { mtimeMs, size, stats }
const MAX_STATS_CACHE = 500;
let _diskCacheLoaded = false;

function getDiskCachePath() {
	const dataDir = process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'projects', 'relaygent', 'data');
	return path.join(dataDir, 'session-stats-cache.json');
}

function loadDiskCache() {
	if (_diskCacheLoaded) return;
	_diskCacheLoaded = true;
	try {
		const raw = fs.readFileSync(getDiskCachePath(), 'utf-8');
		const entries = JSON.parse(raw);
		for (const [k, v] of Object.entries(entries)) {
			if (!_statsCache.has(k)) _statsCache.set(k, v);
		}
	} catch { /* no cache file yet */ }
}

let _dirty = false;
function markDirty() { _dirty = true; }

export function flushStatsCache() {
	if (!_dirty) return;
	_dirty = false;
	try {
		const obj = Object.fromEntries(_statsCache);
		const cachePath = getDiskCachePath();
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(obj));
	} catch { /* ignore write errors */ }
}

function extractMainGoal(content) {
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toUpperCase().includes('MAIN GOAL')) {
			for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
				const s = lines[j].trim().replace(/^[*#\- ]+/, '').replace(/\*+/g, '');
				if (s) return s.slice(0, 120);
			}
		}
	}
	return null;
}

export function parseSessionStats(jsonlPath) {
	try {
		loadDiskCache();
		const stat = fs.statSync(jsonlPath);
		if (stat.size < 500) return null;

		const hit = _statsCache.get(jsonlPath);
		if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.stats;

		const content = fs.readFileSync(jsonlPath, 'utf-8');
		const lines = content.trim().split('\n');
		if (lines.length < 2) return null;

		let startTs = null, endTs = null, totalTokens = 0, outputTokens = 0;
		const tools = {};
		let toolCalls = 0, textBlocks = 0, turns = 0, firstText = null, handoffGoal = null;

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				const ts = entry.timestamp;
				if (ts) {
					if (!startTs) startTs = ts;
					endTs = ts;
				}
				if (entry.type === 'assistant') {
					turns++;
					const usage = entry.message?.usage;
					if (usage) {
						totalTokens += (usage.input_tokens || 0)
							+ (usage.cache_creation_input_tokens || 0)
							+ (usage.cache_read_input_tokens || 0);
						outputTokens += usage.output_tokens || 0;
					}
					const content = entry.message?.content;
					if (Array.isArray(content)) {
						for (const item of content) {
							if (item?.type === 'tool_use') {
								const name = item.name || 'unknown';
								tools[name] = (tools[name] || 0) + 1;
								toolCalls++;
								if (name === 'Write' && /handoff/i.test(item.input?.file_path || '')) {
									handoffGoal = extractMainGoal(item.input?.content || '');
								}
							} else if (item?.type === 'text' && item.text?.length > 5) {
								textBlocks++;
								if (!firstText) firstText = item.text.split('\n')[0].slice(0, 100);
							}
						}
					}
				}
			} catch { /* skip bad lines */ }
		}

		if (!startTs) return null;

		const start = new Date(startTs);
		const end = new Date(endTs);
		const durationMin = Math.round((end - start) / 60000);

		const result = {
			start: startTs, durationMin, totalTokens, outputTokens,
			toolCalls, textBlocks, turns, tools, firstText, handoffGoal,
			contextPct: Math.round(totalTokens / 2000),
		};

		if (_statsCache.size >= MAX_STATS_CACHE) {
			const first = _statsCache.keys().next().value;
			_statsCache.delete(first);
		}
		_statsCache.set(jsonlPath, { mtimeMs: stat.mtimeMs, size: stat.size, stats: result });
		markDirty();

		return result;
	} catch { return null; }
}
