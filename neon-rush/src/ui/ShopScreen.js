// Shop screen builder (W1-UI): skins from src/player/skins.js + save-driven
// perks from Economy. Buy/equip states, coins balance, insufficient-funds
// shake + toast. Purchases persist via Save. Rebuilt on each show (18 cards,
// menu layer — never in a hot loop).
import { el, fmt } from './dom.js';
import { economy } from '../game/Economy.js';
import { save } from '../core/Save.js';

const SWATCH_GLYPH = { perk: '◈' };

function cardHtml(item) {
  const owned = economy.owns(item.id);
  const equipped = item.kind === 'skin' && economy.equipped() === item.id;
  let action;
  if (owned && equipped) action = '<div class="card-state state-equipped">EQUIPPED</div>';
  else if (owned) action = item.kind === 'skin'
    ? '<button class="btn btn-card act-equip">EQUIP</button>'
    : '<div class="card-state state-active">ACTIVE</div>';
  else action = `<button class="btn btn-card act-buy">BUY<b>${fmt(item.price)}</b></button>`;
  const swatch = item.kind === 'skin'
    ? `<div class="card-swatch skin" style="--c1:${item.primary};--c2:${item.accent}"><i></i></div>`
    : `<div class="card-swatch perk">${SWATCH_GLYPH.perk}</div>`;
  return swatch +
    `<div class="card-kind">${item.kind === 'skin' ? 'PILOT SUIT' : 'IMPLANT'}</div>` +
    `<div class="card-name">${item.name}</div>` +
    `<div class="card-desc">${item.desc}</div>` + action;
}

export function buildShop(ui) {
  const s = el('div', 'screen');
  s.id = 's-shop';

  const panel = el('div', 'meta-panel shop-panel');
  const head = el('div', 'meta-head');
  const ht = el('div', 'meta-head-t');
  ht.appendChild(el('div', 'meta-title', 'SHOP'));
  ht.appendChild(el('div', 'meta-sub', 'GEAR UP · HYPERDROME OUTPOST 7'));
  head.appendChild(ht);
  const coins = el('div', 'chip chip-coins', '<span class="coin-dot"></span><b>0</b>');
  coins.id = 'shop-coins';
  head.appendChild(coins);
  const close = el('button', 'meta-close', '✕');
  close.setAttribute('aria-label', 'close shop');
  close.addEventListener('click', () => ui.back());
  head.appendChild(close);
  panel.appendChild(head);

  panel.appendChild(el('div', 'meta-sec-label', 'PILOT SUITS'));
  const grid = el('div', 'shop-grid');
  grid.id = 'shop-grid';
  panel.appendChild(grid);

  panel.appendChild(el('div', 'meta-sec-label', 'IMPLANTS'));
  const perks = el('div', 'shop-grid shop-perks');
  perks.id = 'shop-perks';
  panel.appendChild(perks);

  const foot = el('div', 'meta-foot');
  foot.id = 'shop-foot';
  panel.appendChild(foot);

  // one delegated listener — cards are rebuilt on every refresh
  panel.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const item = economy.catalog.find((c) => c.id === id);
    if (!item) return;
    if (economy.owns(id)) {
      if (item.kind === 'skin' && economy.equipped() !== id) economy.equip(id);
      ui.refreshShop();
      return;
    }
    const res = economy.buy(id);
    ui.refreshShop(); // rebuild first — shake must land on the fresh node
    if (!res.ok && res.reason === 'funds') {
      const fresh = panel.querySelector(`.card[data-id="${id}"]`);
      if (fresh) {
        fresh.classList.remove('shake');
        void fresh.offsetWidth; // restart transform animation
        fresh.classList.add('shake');
      }
      ui.toast('NOT ENOUGH COINS', 'info');
    }
  });

  s.appendChild(panel);
  ui.shopEls = { grid, perks, coins, foot };
  return s;
}

export function refreshShop(ui) {
  const e = ui.shopEls;
  if (!e) return;
  const items = economy.buildCatalog();
  e.coins.innerHTML = `<span class="coin-dot"></span><b>${fmt(save.data.coins)}</b>`;
  e.grid.innerHTML = items.filter((i) => i.kind === 'skin').map((i) =>
    `<div class="card${economy.equipped() === i.id ? ' equipped' : ''}" data-id="${i.id}">${cardHtml(i)}</div>`).join('');
  e.perks.innerHTML = items.filter((i) => i.kind === 'perk').map((i) =>
    `<div class="card${economy.owns(i.id) ? ' owned' : ''}" data-id="${i.id}">${cardHtml(i)}</div>`).join('');
  e.foot.innerHTML =
    `<span>SHARDS <b>${save.data.shards}</b>/5</span>` +
    `<span class="dim">MYSTERY BOXES DROP IN THE GRID — SHARDS FORGE RANDOM SUITS</span>` +
    `<span>LV <b>${save.data.level}</b></span>`;
}
