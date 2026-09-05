import { initErrorScreen } from './ui/errorScreen';
import { Game } from './game';
const errors = initErrorScreen();
async function boot() {
    try {
        if (matchMedia('(pointer: coarse)').matches) {
            document.getElementById('coarse-warning').classList.remove('hidden');
            return;
        }
        const canvas = document.getElementById('game');
        const game = new Game(canvas);
        // start() awaits Rapier WASM init — outside the try below, so surface
        // async failures on the error screen explicitly.
        game.start().catch((err) => errors.show('Physics init failed', String(err)));
        if (import.meta.env.DEV) {
            // Verification hook: read-only handles for browser tooling. Dev
            // builds only — tree-shaken from production.
            window.__lugaru = {
                game,
                ...game.devHandles,
            };
        }
    }
    catch (err) {
        errors.show('Failed to start', String(err));
    }
}
boot();
