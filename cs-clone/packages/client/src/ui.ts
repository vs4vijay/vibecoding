import type { WeaponState, Team, MatchState } from '@cs-clone/shared';
import { WEAPONS } from '@cs-clone/shared';

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
