// Shared light/dark/auto theme state. `auto` follows the device's
// prefers-color-scheme live; light/dark pin it. Persisted in localStorage.
// Consumers read theme.pref / theme.systemDark reactively; the Settings
// dropdown writes via setTheme(); the layout applies isDark() to the DOM.
import { browser } from '$app/environment';

const KEY = 'theme';
export const THEME_OPTIONS = ['auto', 'light', 'dark'];

export const theme = $state({ pref: 'auto', systemDark: false, ready: false });

export function initTheme() {
	if (!browser || theme.ready) return;
	let stored = localStorage.getItem(KEY);
	if (!THEME_OPTIONS.includes(stored)) {
		// Migrate the legacy boolean `darkMode` flag; otherwise default to auto.
		const old = localStorage.getItem('darkMode');
		stored = old === 'true' ? 'dark' : old === 'false' ? 'light' : 'auto';
	}
	theme.pref = stored;
	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	theme.systemDark = mq.matches;
	mq.addEventListener('change', (e) => { theme.systemDark = e.matches; });
	theme.ready = true;
}

export function setTheme(pref) {
	if (!THEME_OPTIONS.includes(pref)) return;
	theme.pref = pref;
	if (browser) localStorage.setItem(KEY, pref);
}

// Effective dark state: explicit dark, or auto + device prefers dark.
export function isDark() {
	return theme.pref === 'dark' || (theme.pref === 'auto' && theme.systemDark);
}
