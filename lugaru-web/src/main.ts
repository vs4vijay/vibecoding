import { initErrorScreen } from './ui/errorScreen';

const errors = initErrorScreen();

async function boot() {
  try {
    if (matchMedia('(pointer: coarse)').matches) {
      document.getElementById('coarse-warning')!.classList.remove('hidden');
      return;
    }
    // TODO(later tasks): create renderer + game here.
    console.log('boot ok');
  } catch (err) {
    errors.show('Failed to start', String(err));
  }
}

boot();
