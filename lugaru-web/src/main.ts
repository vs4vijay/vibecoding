import { initErrorScreen } from './ui/errorScreen';
import { Game } from './game';

const errors = initErrorScreen();

async function boot() {
  try {
    if (matchMedia('(pointer: coarse)').matches) {
      document.getElementById('coarse-warning')!.classList.remove('hidden');
      return;
    }

    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const game = new Game(canvas);
    game.start();

    if (import.meta.env.DEV) {
      // Verification hook: read-only handles for browser tooling. Dev
      // builds only — tree-shaken from production.
      (window as unknown as Record<string, unknown>).__lugaru = {
        game,
        ...game.devHandles,
      };
    }
  } catch (err) {
    errors.show('Failed to start', String(err));
  }
}

boot();
