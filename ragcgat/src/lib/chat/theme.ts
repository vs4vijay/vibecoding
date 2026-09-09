export type Theme = 'light' | 'dark';

/** Allow-listed storage key, shared with the pre-paint init script in app.html. */
export const THEME_STORAGE_KEY = 'ragchat:theme';

/**
 * Theme resolution matrix: stored preference (allow-list 'light'|'dark' —
 * anything else is treated as cache poison, T-04-06) → system
 * prefers-color-scheme → light. Reads globals defensively so prerender/SSR
 * resolves to light without touching storage.
 */
export function resolveInitialTheme(): Theme {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		// storage unavailable (prerender, privacy mode) — fall through to system
	}
	if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
		return 'dark';
	}
	return 'light';
}

/** Apply + persist: toggles the .dark class that Tailwind's @custom-variant keys on. */
export function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle('dark', theme === 'dark');
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// persistence is best-effort; the class toggle already took effect
	}
}
