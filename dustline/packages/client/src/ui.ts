import type { WeaponState, Team, MatchState } from '@dustline/shared';
import { WEAPONS } from '@dustline/shared';

interface HUDState {
  health: number;
  armor: number;
  isDead: boolean;
  currentWeapon: WeaponState | null;
  matchState: MatchState | null;
  playerCount: number;
  playerTeam: Team | null;
}

let lastState: HUDState | null = null;

export function initUI(state: HUDState): void {
  if (JSON.stringify(state) === JSON.stringify(lastState)) return;
  lastState = state;

  // Health
  const healthEl = document.getElementById('healthValue');
  if (healthEl) {
    healthEl.textContent = Math.max(0, state.health).toString();
    healthEl.style.color = state.health > 50 ? '#fff' : state.health > 25 ? '#f39c12' : '#e74c3c';
  }

  // Armor
  const armorEl = document.getElementById('armorValue');
  if (armorEl) {
    armorEl.textContent = Math.max(0, state.armor).toString();
  }

  // Weapon
  const weaponNameEl = document.getElementById('weaponName');
  const ammoMagEl = document.getElementById('ammoMag');
  const ammoReserveEl = document.getElementById('ammoReserve');

  if (state.currentWeapon && weaponNameEl && ammoMagEl && ammoReserveEl) {
    const weapon = WEAPONS[state.currentWeapon.typeId];
    if (weapon) {
      weaponNameEl.textContent = state.currentWeapon.isReloading ? 'RELOADING...' : weapon.name;
      ammoMagEl.textContent = state.currentWeapon.ammoInMagazine.toString();
      ammoReserveEl.textContent = state.currentWeapon.ammoInReserve.toString();
    }
  }

  // Timer
  const timerEl = document.getElementById('matchTimer');
  if (timerEl && state.matchState) {
    const remaining = Math.max(0, state.matchState.timeRemaining);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    timerEl.style.color = state.matchState.status === 'warmup' ? '#f39c12' : remaining < 30000 ? '#e74c3c' : '#fff';
  }

  // Score
  const tScoreEl = document.getElementById('tScore');
  const ctScoreEl = document.getElementById('ctScore');
  if (tScoreEl && ctScoreEl && state.matchState) {
    tScoreEl.textContent = state.matchState.tScore.toString();
    ctScoreEl.textContent = state.matchState.ctScore.toString();
  }

  // Team label
  const teamEl = document.getElementById('playerTeam');
  if (teamEl && state.playerTeam) {
    teamEl.textContent = state.playerTeam;
    teamEl.className = `team-label ${state.playerTeam}`;
  }

  // Death screen
  const deathScreen = document.getElementById('deathScreen');
  if (deathScreen) {
    if (state.isDead) {
      deathScreen.classList.remove('hidden');
    } else {
      deathScreen.classList.add('hidden');
    }
  }
}

// ─── Leaderboard (persistent stats, toggle with L) ───────
export interface LeaderboardEntry {
  username: string;
  totalKills: number;
  totalDeaths: number;
  kd: number;
  headshots: number;
  matches: number;
  wins: number;
  losses: number;
  accuracy: number;
}

let leaderboardVisible = false;

export function isLeaderboardVisible(): boolean {
  return leaderboardVisible;
}

/** Toggle the leaderboard panel; fetches fresh entries when opening. */
export async function toggleLeaderboard(): Promise<void> {
  const panel = document.getElementById('leaderboardPanel');
  if (!panel) return;
  leaderboardVisible = !leaderboardVisible;
  panel.classList.toggle('hidden', !leaderboardVisible);
  if (leaderboardVisible) {
    await refreshLeaderboard();
  }
}

async function refreshLeaderboard(): Promise<void> {
  const body = document.getElementById('leaderboardBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" class="leaderboard-status">Loading...</td></tr>';
  try {
    // Same-origin fetch: in dev the vite proxy forwards /leaderboard to the
    // game server (see vite.config.ts); in production the server serves the
    // client build itself, so no CORS handling is needed.
    const res = await fetch('/leaderboard?limit=20');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = (await res.json()) as LeaderboardEntry[];
    renderLeaderboard(body, entries);
  } catch (err) {
    // Render gracefully — never leave an unhandled rejection behind.
    console.error('Leaderboard fetch failed:', err);
    body.innerHTML = '<tr><td colspan="7" class="leaderboard-status">Leaderboard unavailable</td></tr>';
  }
}

function renderLeaderboard(body: HTMLElement, entries: LeaderboardEntry[]): void {
  if (entries.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="leaderboard-status">No recorded players yet</td></tr>';
    return;
  }
  body.innerHTML = entries.map((e, i) => {
    const accuracyPct = Math.round(e.accuracy * 100);
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(e.username)}</td>
      <td>${e.kd.toFixed(2)}</td>
      <td>${e.totalKills}</td>
      <td>${e.totalDeaths}</td>
      <td>${accuracyPct}%</td>
      <td>${e.wins}/${e.losses}</td>
    </tr>`;
  }).join('');
}

/**
 * Escape a string for safe interpolation into innerHTML. User-controlled
 * values (usernames, chat) must never reach an HTML template unescaped.
 */
export function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, ch => entities[ch] ?? ch);
}

// ─── Hitmarker / damage feedback / crosshair spread ───
/** Flash the hitmarker X; retrigger-safe via reflow. Null-safe. */
export function showHitmarker(): void {
  const el = document.getElementById('hitmarker');
  if (!el) return;
  el.classList.remove('show');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add('show');
}

/** Set the red edge-vignette opacity (0–1). Null-safe; CSS fades it out. */
export function setDamageFlash(intensity: number): void {
  const el = document.getElementById('damageVignette') as HTMLElement | null;
  if (!el) return;
  const v = Math.min(1, Math.max(0, intensity));
  el.style.transition = 'none';
  el.style.opacity = v.toFixed(2);
  void el.offsetWidth;
  el.style.transition = '';
}
/** Reset the damage vignette to 0. Call on respawn/heal. Null-safe. */
export function resetDamageFlash(): void {
  const el = document.getElementById('damageVignette') as HTMLElement | null;
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = '0';
  void el.offsetWidth;
  el.style.transition = '';
}

/** Set crosshair gap in px via the `--spread` var. Null-safe. */
export function setCrosshairSpread(px: number): void {
  const el = document.getElementById('crosshair') as HTMLElement | null;
  if (!el) return;
  el.style.setProperty('--spread', `${Math.max(0, px)}px`);
}
