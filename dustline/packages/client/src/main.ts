import './styles.css';
import { initGame, connectAndPlay } from './game.js';

// Login form
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
const teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

connectBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim() || 'Player';
  const team = teamSelect.value as 'T' | 'CT';

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  try {
    // Initialize the game (Three.js scene) first
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    await initGame(canvas);

    // Connect to server
    await connectAndPlay(username, team);
  } catch (err) {
    console.error('Connection failed:', err);
    alert('Connection failed. Please try again.');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

// Enter key on username input
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
});

// Focus username on load
usernameInput.focus();

// Sensitivity slider persistence (game.ts reads the live value)
const SENS_KEY = 'dustline:sensitivity';
const sensInput = document.getElementById('sensitivityInput') as HTMLInputElement | null;
if (sensInput) {
  try {
    const saved = localStorage.getItem(SENS_KEY);
    if (saved !== null && Number.isFinite(Number(saved))) sensInput.value = saved;
  } catch { /* storage unavailable — keep default */ }
  sensInput.addEventListener('input', () => {
    try { localStorage.setItem(SENS_KEY, sensInput.value); } catch { /* ignore */ }
  });
}
