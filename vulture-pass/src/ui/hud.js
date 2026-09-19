// Combat HUD (spec: health, money, day, speed, both mounts' states).
// DOM overlay; reads state + player entity, never mutates them.

import { weapons } from '../game/data/content.js';

export function createHud() {
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-chip hud-health"><span class="hud-label">HULL</span>
        <div class="hud-bar"><div class="hud-bar-fill" id="hud-health-fill"></div></div>
        <span class="hud-value" id="hud-health-num"></span>
      </div>
      <div class="hud-chip" id="hud-money"></div>
      <div class="hud-chip" id="hud-day"></div>
    </div>
    <div class="hud-bottom">
      <div class="hud-mount" id="hud-mount-left">
        <span class="hud-mount-side">L</span>
        <span class="hud-mount-name" id="hud-mount-left-name">—</span>
        <div class="hud-bar hud-mount-bar"><div class="hud-bar-fill" id="hud-mount-left-fill"></div></div>
        <span class="hud-mount-state" id="hud-mount-left-state"></span>
      </div>
      <div class="hud-speed" id="hud-speed">0</div>
      <div class="hud-mount" id="hud-mount-right">
        <span class="hud-mount-side">R</span>
        <span class="hud-mount-name" id="hud-mount-right-name">—</span>
        <div class="hud-bar hud-mount-bar"><div class="hud-bar-fill" id="hud-mount-right-fill"></div></div>
        <span class="hud-mount-state" id="hud-mount-right-state"></span>
      </div>
    </div>
  `;
  document.getElementById('ui-root').appendChild(root);

  const el = {};
  for (const id of [
    'health-fill',
    'health-num',
    'money',
    'day',
    'speed',
    'mount-left',
    'mount-right',
    'mount-left-name',
    'mount-right-name',
    'mount-left-fill',
    'mount-right-fill',
    'mount-left-state',
    'mount-right-state',
  ]) {
    el[id] = document.getElementById(`hud-${id}`);
  }

  let mountFlash = { left: 0, right: 0 };

  function update(state, player, dt) {
    if (!player) return;
    const hp = Math.max(0, Math.round(player.health));
    const max = player.maxHealth;
    el['health-fill'].style.width = `${(hp / max) * 100}%`;
    el['health-fill'].classList.toggle('low', hp / max < 0.3);
    el['health-num'].textContent = `${hp}/${max}`;
    el.money.textContent = `$${state.money}`;
    el.day.textContent = `Day ${state.day}`;

    const speed = Math.round(Math.abs(player.drive.speedFwd) * 2.35);
    el.speed.textContent = `${speed}`;

    for (const side of ['left', 'right']) {
      const wid = state.mounts[side];
      const mount = player.mounts?.[side];
      const nameEl = el[`mount-${side}-name`];
      const stateEl = el[`mount-${side}-state`];
      const fillEl = el[`mount-${side}-fill`];
      const boxEl = el[`mount-${side}`];
      if (!wid) {
        nameEl.textContent = 'EMPTY';
        stateEl.textContent = '';
        fillEl.style.width = '0%';
        boxEl.classList.remove('reloading', 'firing');
        continue;
      }
      const w = weapons[wid];
      nameEl.textContent = w.name.split(' ')[0].toUpperCase();
      const total = w.reload * Math.pow(1 - 0.12, state.upgrades.reload);
      const left = mount ? mount.reloadLeft : 0;
      const bursting = mount && mount.burstLeft > 0;
      if (left > 0) {
        stateEl.textContent = 'RELOAD';
        fillEl.style.width = `${100 * (1 - left / total)}%`;
        boxEl.classList.add('reloading');
        boxEl.classList.remove('firing');
      } else if (bursting) {
        stateEl.textContent = 'FIRING';
        fillEl.style.width = '100%';
        boxEl.classList.add('firing');
        boxEl.classList.remove('reloading');
      } else {
        stateEl.textContent = 'READY';
        fillEl.style.width = '100%';
        boxEl.classList.remove('reloading');
        boxEl.classList.add('firing');
      }
    }
  }

  function destroy() {
    root.remove();
  }

  return { update, destroy, root };
}
