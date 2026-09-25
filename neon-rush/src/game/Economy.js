// W1-UI meta economy: coin balance, XP curve + level-ups, shop catalog
// (skins + save-driven perks), mystery-box weighted table, persisted settings
// application (quality tier + bloom override).
//
// Coin banking: Game.endRun already does `save.data.coins += s.runCoins` before
// emitting 'run:end' — this module NEVER re-adds run coins (only spend/award
// paths: mission rewards, daily streaks, boxes, ×2 banking).
// Perk gameplay hooks are getters for later waves: economy.has('perk:shield').
import { bus } from '../core/EventBus.js';
import { save } from '../core/Save.js';
import { SKINS, SKIN_IDS, resolveSkin } from '../player/skins.js';

// XP needed to clear a level (progress-within-level model, see onRunEnd).
export const xpForLevel = (lvl) => 150 + (Math.max(1, lvl) - 1) * 110;

// Flat revive price (design D1) — consumed by the Game REVIVE offer, once per run.
export const REVIVE_COST = 250;

// Auto-unlocked cosmetics per level (first unowned wins at that level).
const LEVEL_UNLOCKS = { 2: 'nova', 3: 'bit', 5: 'ghost', 7: 'vandal', 9: 'jett' };

// Mystery box weighted table (ARCHITECTURE: coins 60 / power-up 25 / shard 10 / ×2 5).
const BOX = [
  { kind: 'coins', w: 60 },
  { kind: 'power', w: 25 },
  { kind: 'shard', w: 10 },
  { kind: 'x2', w: 5 },
];

// Shop catalog — skins priced by tier of the suit, perks are save-driven flags.
const SKIN_PRICES = {
  vector: 0, nova: 300, bit: 450, rogue: 450, titan: 600, ghost: 800,
  circuit: 900, vandal: 900, oracle: 1100, rook: 1300, jett: 1300,
  kilo: 1600, hexa: 2000, dusk: 2600,
};
const PERKS = [
  { id: 'perk:headstart', name: 'HEAD START', desc: 'BEGIN 300 M AHEAD OF THE STATIC', price: 500 },
  { id: 'perk:magnet', name: 'MAGNET CORE', desc: 'STRONGER ORB MAGNET PULL', price: 600 },
  { id: 'perk:comboguard', name: 'COMBO GUARD', desc: 'COMBO DECAYS 50% SLOWER', price: 750 },
  { id: 'perk:shield', name: 'AEGIS SHIELD', desc: 'SURVIVE ONE CRASH PER RUN', price: 900 },
];

class Economy {
  constructor() {
    this.catalog = [];
    this._skinned = false;
    this._shieldImplantUsed = false; // once-per-run AEGIS SHIELD latch (see shield section)
  }

  // [W1-UI] main.js hookup: Economy.init({ game, save, bus, quality })
  init(deps) {
    if (this._skinned) return;
    this._skinned = true;
    this.game = deps.game;
    this.quality = deps.quality;
    this.applyQualitySetting();
    this.applyBloomOverride();
    bus.on('run:end', (p) => this.onRunEnd(p));
    bus.on('run:start', () => { this._shieldImplantUsed = false; });
  }

  // ---- catalog ---------------------------------------------------------------

  // Rebuilt lazily on each shop refresh — cheap (18 items), keeps owned/equipped live.
  buildCatalog() {
    const d = save.data;
    const items = [];
    for (const id of SKIN_IDS) {
      const def = SKINS[id];
      items.push({
        id, kind: 'skin', name: def.name,
        desc: def.acc && Object.keys(def.acc).length ? 'SUIT · MODDED FRAME' : 'SUIT · STANDARD FRAME',
        price: SKIN_PRICES[id] != null ? SKIN_PRICES[id] : 1000,
        primary: def.c.primary, accent: def.c.accent,
      });
    }
    for (const p of PERKS) items.push({ id: p.id, kind: 'perk', name: p.name, desc: p.desc, price: p.price });
    this.catalog = items;
    return items;
  }

  owns(id) { return id === 'vector' || save.data.unlocks.indexOf(id) !== -1; }
  has(id) { return this.owns(id); } // perk getter for later waves
  // legacy aliases ('cyber') resolve to canonical ids so the default suit
  // correctly shows EQUIPPED in the shop
  equipped() { return resolveSkin(save.data.skin).id; }

  // { ok, reason: 'funds'|'owned' } — purchases persist via save.
  buy(id) {
    const item = this.catalog.find((c) => c.id === id) || this.buildCatalog().find((c) => c.id === id);
    if (!item) return { ok: false, reason: 'missing' };
    if (this.owns(id)) return { ok: false, reason: 'owned' };
    if (save.data.coins < item.price) return { ok: false, reason: 'funds' };
    save.data.coins -= item.price;
    save.data.unlocks.push(id);
    save.save();
    if (item.kind === 'skin') this.equip(id);
    bus.emit('ui:toast', { msg: `${item.name} UNLOCKED`, kind: 'success' });
    return { ok: true };
  }

  // Persisted equip + live repaint via Character.setSkin (no Player edit needed).
  equip(id) {
    save.data.skin = id;
    save.save();
    const ch = this.game && this.game.player && this.game.player.character;
    if (ch && ch.setSkin) ch.setSkin(id);
    const label = SKINS[id] ? SKINS[id].name : id.toUpperCase();
    bus.emit('ui:toast', { msg: `${label} EQUIPPED`, kind: 'info' });
  }

  addCoins(n) {
    save.data.coins += n;
    save.save();
  }

  // ---- XP / levels -------------------------------------------------------------

  // run:end payload: { score, best, dist, coins, isBest, pct, cause } (fresh object).
  onRunEnd(p) {
    const d = save.data;
    const gain = Math.floor((p.dist || 0) * 0.05) + (p.coins || 0) * 2 + (p.isBest ? 150 : 0);
    d.xp += gain;
    while (d.xp >= xpForLevel(d.level)) {
      d.xp -= xpForLevel(d.level);
      d.level++;
      bus.emit('ui:toast', { msg: `LEVEL UP — PILOT LV ${d.level}`, kind: 'success' });
      const gift = LEVEL_UNLOCKS[d.level];
      if (gift && !this.owns(gift)) {
        d.unlocks.push(gift);
        bus.emit('ui:toast', { msg: `${SKINS[gift] ? SKINS[gift].name : gift} UNLOCKED — VISIT THE SHOP`, kind: 'reward' });
      }
    }
    if (d.x2Next && p.coins > 0) {
      d.x2Next = false;
      this.addCoins(p.coins); // Game already banked the run coins once — this doubles them
      bus.emit('ui:toast', { msg: `×2 COINS BANKED — +${p.coins}`, kind: 'reward' });
    }
    save.save();
  }

  // ---- shield (AEGIS SHIELD implant + stored charges) ------------------------------

  // Total crash absorptions to arm at run start (read by Game.startRun).
  // The implant grants exactly ONE per run; stored charges arm EXTRA absorptions.
  shieldUses() {
    return (this.has('perk:shield') ? 1 : 0) + (save.data.charges.shield || 0);
  }

  // Spend one absorption: implant use first (latched once per run), then stored
  // charges. Charges leave the save only when actually absorbed, so an unused
  // charge survives the run (design D3/D4). Returns false when nothing is armed.
  spendShieldUse() {
    if (this.has('perk:shield') && !this._shieldImplantUsed) {
      this._shieldImplantUsed = true;
      return true;
    }
    const c = save.data.charges;
    if ((c.shield || 0) > 0) {
      c.shield--;
      save.save();
      return true;
    }
    return false;
  }

  // ---- mystery box ---------------------------------------------------------------

  openBox() {
    const d = save.data;
    // Lifetime counter gates the box mission template (design D9) — every box counts.
    d.stats.boxesOpened = (d.stats.boxesOpened || 0) + 1;
    let roll = Math.random() * 100, kind = BOX[0].kind;
    for (const b of BOX) { if (roll < b.w) { kind = b.kind; break; } roll -= b.w; }
    let reward;
    if (kind === 'coins') {
      const amount = 40 + Math.floor(Math.random() * 61) + d.level * 5;
      this.addCoins(amount);
      reward = { kind: 'coins', amount };
      bus.emit('ui:toast', { msg: `MYSTERY BOX — +${amount} COINS`, kind: 'reward' });
    } else if (kind === 'power') {
      const ids = ['x2', 'shield', 'headstart'];
      const id = ids[Math.floor(Math.random() * ids.length)];
      d.charges[id] = (d.charges[id] || 0) + 1;
      save.save();
      reward = { kind: 'power', id };
      bus.emit('ui:toast', { msg: `MYSTERY BOX — ${id.toUpperCase()} CHARGE`, kind: 'reward' });
    } else if (kind === 'shard') {
      const n = 1 + (Math.random() < 0.25 ? 1 : 0);
      d.shards += n;
      reward = { kind: 'shard', amount: n };
      let msg = `SKIN SHARD +${n} — ${d.shards}/5`;
      if (d.shards >= 5) {
        d.shards -= 5;
        const locked = SKIN_IDS.filter((s) => !this.owns(s));
        if (locked.length) {
          const win = locked[Math.floor(Math.random() * locked.length)];
          d.unlocks.push(win);
          msg = `SHARDS ASSEMBLED — ${SKINS[win].name} UNLOCKED`;
          reward.skin = win;
        }
      }
      save.save();
      bus.emit('ui:toast', { msg, kind: 'reward' });
    } else {
      d.x2Next = true;
      save.save();
      reward = { kind: 'x2' };
      bus.emit('ui:toast', { msg: 'MYSTERY BOX — ×2 COINS NEXT RUN', kind: 'reward' });
    }
    bus.emit('box:open', reward);
    return reward;
  }

  // ---- persisted settings ---------------------------------------------------------

  // Applied at boot after Audio.init (Audio reads settings.mute itself).
  applyQualitySetting() {
    if (!this.quality) return;
    const q = save.data.settings.quality;
    if (q && q !== 'auto') {
      this.quality.adaptive = false; // explicit tiers pin — overrides main.js default
      this.quality.set(q);
    }
  }

  // settings.bloom gates the tier's bloom flag on every post-stack rebuild.
  // Runtime chaining of Quality's registration hook — no other file edited.
  applyBloomOverride() {
    if (!this.quality) return;
    const prev = this.quality.onFlags;
    this.quality.onFlags = (flags) => {
      if (!prev) return;
      const f = Object.assign({}, flags, { bloom: !!flags.bloom && save.data.settings.bloom !== false });
      prev(f);
    };
    if (save.data.settings.bloom === false) this.quality.onFlags(this.quality.flags);
  }

  setBloom(on) {
    save.data.settings.bloom = !!on;
    save.save();
    if (this.quality && this.quality.onFlags) this.quality.onFlags(this.quality.flags);
  }

  setQuality(name) {
    if (!this.quality) return;
    save.data.settings.quality = name;
    save.save();
    if (name === 'auto') { this.quality.adaptive = true; return; }
    this.quality.adaptive = false;
    this.quality.set(name);
  }
}

export const economy = new Economy();
