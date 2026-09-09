import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, applyTheme, resolveInitialTheme } from '../theme';

function stubStorage(stored: string | null | 'throw'): void {
	vi.stubGlobal('localStorage', {
		getItem: () => {
			if (stored === 'throw') throw new Error('storage denied');
			return stored;
		},
		setItem: vi.fn(),
	});
}

function stubMatchMedia(matches: boolean | 'absent'): void {
	if (matches === 'absent') {
		vi.stubGlobal('matchMedia', undefined);
	} else {
		vi.stubGlobal('matchMedia', () => ({ matches }));
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveInitialTheme', () => {
	it('resolves stored light regardless of the system theme', () => {
		for (const systemDark of [true, false]) {
			stubStorage('light');
			stubMatchMedia(systemDark);
			expect(resolveInitialTheme()).toBe('light');
		}
	});

	it('resolves stored dark regardless of the system theme', () => {
		for (const systemDark of [true, false]) {
			stubStorage('dark');
			stubMatchMedia(systemDark);
			expect(resolveInitialTheme()).toBe('dark');
		}
	});

	it('treats invalid stored values as cache poison and falls back to system', () => {
		for (const poison of ['banana', 'DARK', '', 'system']) {
			stubStorage(poison);
			stubMatchMedia(true);
			expect(resolveInitialTheme()).toBe('dark');
			stubStorage(poison);
			stubMatchMedia(false);
			expect(resolveInitialTheme()).toBe('light');
		}
	});

	it('follows matchMedia when nothing is stored', () => {
		stubStorage(null);
		stubMatchMedia(true);
		expect(resolveInitialTheme()).toBe('dark');
		stubStorage(null);
		stubMatchMedia(false);
		expect(resolveInitialTheme()).toBe('light');
	});

	it('falls back to light when storage and matchMedia are both unavailable', () => {
		stubStorage('throw');
		stubMatchMedia('absent');
		expect(resolveInitialTheme()).toBe('light');
		stubStorage(null);
		stubMatchMedia('absent');
		expect(resolveInitialTheme()).toBe('light');
	});
});

describe('applyTheme', () => {
	it('toggles the dark class and persists the choice', () => {
		const toggle = vi.fn();
		const setItem = vi.fn();
		vi.stubGlobal('document', { documentElement: { classList: { toggle } } });
		vi.stubGlobal('localStorage', { getItem: () => null, setItem });

		applyTheme('dark');
		expect(toggle).toHaveBeenCalledWith('dark', true);
		expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');

		applyTheme('light');
		expect(toggle).toHaveBeenCalledWith('dark', false);
		expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
	});
});
