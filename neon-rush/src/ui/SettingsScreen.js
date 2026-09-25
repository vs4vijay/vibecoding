// Settings screen builder (W1-UI): mute (mirrors Audio.setMute which persists
// to save.settings.mute), quality tier (LOW/MED/HIGH/ULTRA/AUTO → Quality +
// save.settings.quality), bloom toggle (Economy chain-applies the override to
// the PostFX rebuild hook). ESC/P closes back to the previous screen (UI.js).
import { el } from './dom.js';
import { save } from '../core/Save.js';
import { Audio } from '../audio/Audio.js';
import { economy } from '../game/Economy.js';

const TIERS = ['LOW', 'MED', 'HIGH', 'ULTRA'];

function seg(id, opts) {
  return `<div class="seg" id="${id}">` +
    opts.map((o) => `<button class="seg-btn" data-v="${o.v}">${o.label}</button>`).join('') +
    '</div>';
}

export function buildSettings(ui) {
  const s = el('div', 'screen');
  s.id = 's-settings';

  const panel = el('div', 'meta-panel settings-panel');
  const head = el('div', 'meta-head');
  const ht = el('div', 'meta-head-t');
  ht.appendChild(el('div', 'meta-title', 'SETTINGS'));
  ht.appendChild(el('div', 'meta-sub', 'SYSTEM CONFIG'));
  head.appendChild(ht);
  const close = el('button', 'meta-close', '✕');
  close.setAttribute('aria-label', 'close settings');
  close.addEventListener('click', () => ui.back());
  head.appendChild(close);
  panel.appendChild(head);

  const rows = el('div', 'set-rows');
  rows.innerHTML =
    `<div class="set-row"><div class="set-label">AUDIO<em>SYNTH ENGINE · M TOGGLES</em></div>${seg('set-audio', [{ v: 'on', label: 'ON' }, { v: 'off', label: 'OFF' }])}</div>` +
    `<div class="set-row"><div class="set-label">QUALITY<em>RENDER TIER · AUTO DROPS BELOW 50 FPS</em></div>${seg('set-quality', [{ v: 'LOW', label: 'LOW' }, { v: 'MED', label: 'MED' }, { v: 'HIGH', label: 'HIGH' }, { v: 'ULTRA', label: 'ULTRA' }, { v: 'auto', label: 'AUTO' }])}</div>` +
    `<div class="set-row"><div class="set-label">BLOOM<em>NEON GLOW POST-PROCESS</em></div>${seg('set-bloom', [{ v: 'on', label: 'ON' }, { v: 'off', label: 'OFF' }])}</div>`;
  panel.appendChild(rows);

  panel.appendChild(el('div', 'meta-foot meta-foot-center', 'ESC — BACK'));

  rows.addEventListener('click', (e2) => {
    const btn = e2.target.closest('.seg-btn');
    if (!btn) return;
    const v = btn.dataset.v;
    const segId = btn.parentElement.id;
    if (segId === 'set-audio') Audio.setMute(v === 'off');
    else if (segId === 'set-quality') economy.setQuality(v);
    else if (segId === 'set-bloom') economy.setBloom(v === 'on');
    refreshSettings(ui);
  });

  s.appendChild(panel);
  ui.settingsEls = { rows };
  return s;
}

export function refreshSettings(ui) {
  const e = ui.settingsEls;
  if (!e) return;
  const muted = !!(Audio.muted || save.data.settings.mute);
  const quality = save.data.settings.quality || 'auto';
  const bloom = save.data.settings.bloom !== false;
  const mark = (id, v) => {
    const segEl = e.rows.querySelector('#' + id);
    if (!segEl) return;
    for (const b of segEl.children) b.classList.toggle('on', b.dataset.v === v);
  };
  mark('set-audio', muted ? 'off' : 'on');
  mark('set-quality', quality);
  mark('set-bloom', bloom ? 'on' : 'off');
}
