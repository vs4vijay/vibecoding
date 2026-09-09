<script lang="ts">
import { browser } from '$app/environment';
import { type Theme, applyTheme, resolveInitialTheme } from '$lib/chat/theme';

// The dark class itself is applied pre-paint by the inline script in
// app.html (no flash); this control only mirrors and flips the stored
// preference (OS default holds until the user toggles).
let theme = $state<Theme>('light');

$effect(() => {
	if (browser) theme = resolveInitialTheme();
});

function toggle() {
	theme = theme === 'dark' ? 'light' : 'dark';
	applyTheme(theme);
}
</script>

<button
	type="button"
	class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
	onclick={toggle}
>
	{theme === 'dark' ? 'Light mode' : 'Dark mode'}
</button>
