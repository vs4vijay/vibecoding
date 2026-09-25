// Missions screen builder (W1-UI): 3 active contracts with transform-only
// progress bars + the session completion log. Live data comes straight from
// save.data.missions (owned by game/Missions.js).
import { el, fmt } from './dom.js';
import { save } from '../core/Save.js';
import { missions, missionDesc } from '../game/Missions.js';

export function buildMissions(ui) {
  const s = el('div', 'screen');
  s.id = 's-missions';

  const panel = el('div', 'meta-panel missions-panel');
  const head = el('div', 'meta-head');
  const ht = el('div', 'meta-head-t');
  ht.appendChild(el('div', 'meta-title', 'MISSIONS'));
  ht.appendChild(el('div', 'meta-sub', 'LIVE CONTRACTS · AUTO PAYOUT'));
  head.appendChild(ht);
  const close = el('button', 'meta-close', '✕');
  close.setAttribute('aria-label', 'close missions');
  close.addEventListener('click', () => ui.back());
  head.appendChild(close);
  panel.appendChild(head);

  const recent = el('div', 'm-recent');
  recent.id = 'm-recent';
  panel.appendChild(recent);

  const list = el('div', 'mission-list');
  list.id = 'mission-list';
  panel.appendChild(list);

  panel.appendChild(el('div', 'meta-foot meta-foot-center', 'COMPLETE A CONTRACT — PAYOUT IS INSTANT, A NEW ONE ROLLS IN'));
  s.appendChild(panel);
  ui.missionsEls = { recent, list };
  return s;
}

export function refreshMissions(ui) {
  const e = ui.missionsEls;
  if (!e) return;
  const ms = save.data.missions;
  e.list.innerHTML = ms.map((m) => {
    const frac = Math.max(0, Math.min(1, m.prog / m.goal));
    return `<div class="mission-card" data-id="${m.id}">` +
      `<div class="m-top"><span class="m-desc">${missionDesc(m)}</span>` +
      `<span class="m-reward"><span class="coin-dot"></span>+${m.reward}</span></div>` +
      `<div class="m-bar"><i class="m-fill" style="transform:scaleX(${frac.toFixed(3)})"></i></div>` +
      `<div class="m-meta"><b>${fmt(Math.min(m.prog, m.goal))} / ${fmt(m.goal)}</b><span>${m.reward} COINS ON COMPLETION</span></div>` +
      `</div>`;
  }).join('');
  e.recent.innerHTML = missions.recent.length
    ? missions.recent.map((r) => `<span class="m-done">✔ ${r.desc} · +${r.reward}</span>`).join('')
    : '<span class="m-dim">NO CONTRACTS CLEARED THIS SESSION — THE GRID AWAITS</span>';
}
