// GameState + intent-based mutation (D5 risk rule: UI never touches entities
// or state fields directly — it dispatches intents through these functions
// and reads the returned results).

import { cars, weapons, goods, starterCarId, starterWeaponId, towns } from './data/content.js';
import { combat as cbt, economy as eco } from './data/tuning.js';
import { createRng, hashSeed } from './rng.js';

let nextEntityId = 1;

export function createInitialState({ seed = 1234 } = {}) {
  const car = cars[starterCarId];
  return {
    version: 1,
    seed,
    day: 1,
    money: eco.startingMoney,
    location: { kind: 'town', townId: 'polvo' }, // or { kind:'overworld' } while on the map
    carId: starterCarId,
    carHealth: car.maxHealth,
    mounts: { left: starterWeaponId, right: null },
    ownedWeapons: [starterWeaponId],
    cargo: {}, // goodId -> units
    upgrades: { reload: 0, repair: 0, sight: 0 },
    xp: 0,
    level: 1,
    points: 0,
    insurance: false,
    jobs: { active: [], completed: 0, failed: 0 },
    bossDefeated: false,
    kills: 0,
    trips: 0,
    stats: { earned: 0, spent: 0, battlesWon: 0, battlesLost: 0 },
  };
}

// ------------------------------------------------------------------ reads

export function carDef(state) {
  return cars[state.carId];
}

export function cargoUsed(state) {
  let n = 0;
  for (const v of Object.values(state.cargo)) n += v;
  for (const j of state.jobs.active) if (j.kind === 'delivery') n += j.units;
  return n;
}

export function cargoCapacity(state) {
  return carDef(state).cargo;
}

export function cargoValue(state) {
  let v = 0;
  for (const [goodId, qty] of Object.entries(state.cargo)) v += goods[goodId].base * qty;
  return v;
}

export function weaponDef(state, side) {
  const id = state.mounts[side];
  return id ? weapons[id] : null;
}

export function reloadTime(state, weaponId) {
  const w = weapons[weaponId];
  return w.reload * Math.pow(1 - cbt.reloadBonusPerPoint, state.upgrades.reload);
}

export function xpToNext(state) {
  return cbt.xpToNextBase + cbt.xpToNextPerLevel * (state.level - 1);
}

// ------------------------------------------------------------------ intents
// Every mutation returns { ok, reason?, ...detail } so UI layers can render
// refusals with reasons (spec: capacity refusal etc.).

export function grantXp(state, amount) {
  state.xp += amount;
  const leveled = [];
  while (state.xp >= xpToNext(state)) {
    state.xp -= xpToNext(state);
    state.level += 1;
    state.points += 1;
    leveled.push(state.level);
  }
  return { ok: true, leveled };
}

export function spendPoint(state, track) {
  if (!(track in state.upgrades)) return { ok: false, reason: 'Unknown track' };
  if (state.points <= 0) return { ok: false, reason: 'No upgrade points' };
  state.points -= 1;
  state.upgrades[track] += 1;
  return { ok: true, track, level: state.upgrades[track] };
}

export function buyGood(state, townId, goodId, qty) {
  if (!goods[goodId]) return { ok: false, reason: 'Unknown good' };
  qty = Math.floor(qty);
  if (qty <= 0) return { ok: false, reason: 'Quantity must be positive' };
  const free = cargoCapacity(state) - cargoUsed(state);
  if (qty > free) {
    return { ok: false, reason: `Only ${free} cargo space left — can't buy ${qty}.` };
  }
  const unit = townPrice(state, townId, goodId);
  const cost = unit * qty;
  if (cost > state.money) {
    return { ok: false, reason: `Costs $${cost} — you have $${state.money}.` };
  }
  state.money -= cost;
  state.stats.spent += cost;
  state.cargo[goodId] = (state.cargo[goodId] || 0) + qty;
  return { ok: true, unit, cost, qty };
}

export function sellGood(state, townId, goodId, qty) {
  if (!goods[goodId]) return { ok: false, reason: 'Unknown good' };
  qty = Math.floor(qty);
  const have = state.cargo[goodId] || 0;
  if (qty <= 0) return { ok: false, reason: 'Quantity must be positive' };
  if (qty > have) return { ok: false, reason: `Only carrying ${have} ${goods[goodId].name}.` };
  const unit = townPrice(state, townId, goodId);
  const gain = unit * qty;
  state.money += gain;
  state.stats.earned += gain;
  state.cargo[goodId] -= qty;
  if (state.cargo[goodId] === 0) delete state.cargo[goodId];
  return { ok: true, unit, gain, qty };
}

// Per-town price = base × town modifier × daily seeded drift (D6).
// Pure function of (seed, day, town, good) — deterministic, node-testable.
export function townPrice(state, townId, goodId) {
  const town = towns[townId];
  const good = goods[goodId];
  const rng = createRng(hashSeed('price', state.seed, state.day, townId, goodId));
  const drift = 1 + rng.range(-eco.driftRange, eco.driftRange);
  return Math.max(1, Math.round(good.base * (town?.priceMod?.[goodId] ?? 1) * drift));
}

export function repairFee(state) {
  const car = carDef(state);
  const missing = car.maxHealth - state.carHealth;
  return Math.ceil(missing * eco.repairFeeRate * car.price);
}

export function repairCar(state) {
  const fee = repairFee(state);
  if (fee === 0) return { ok: false, reason: 'Nothing to repair.' };
  if (fee > state.money) return { ok: false, reason: `Repair costs $${fee} — you have $${state.money}.` };
  state.money -= fee;
  state.stats.spent += fee;
  state.carHealth = carDef(state).maxHealth;
  return { ok: true, fee };
}

export function buyCar(state, carId, { dropExcess = false } = {}) {
  const car = cars[carId];
  if (!car) return { ok: false, reason: 'Unknown car' };
  if (carId === state.carId) return { ok: false, reason: 'Already driving it.' };
  if (car.price > state.money) return { ok: false, reason: `Costs $${car.price} — you have $${state.money}.` };
  const used = cargoUsed(state);
  const deliveryCargo = state.jobs.active.filter((j) => j.kind === 'delivery');
  if (used > car.cargo && !dropExcess) {
    return { ok: false, reason: `needsConfirm`, detail: `Cargo overflows: carrying ${used}, ${car.name} holds ${car.cargo}. Excess will be lost.` };
  }
  state.money -= car.price;
  state.stats.spent += car.price;
  state.carId = carId;
  // clamp cargo to the new capacity, dropping excess (oldest stacks first)
  let excess = used - car.cargo;
  if (excess > 0) {
    for (const [goodId, qty] of Object.entries(state.cargo)) {
      if (excess <= 0) break;
      const drop = Math.min(qty, excess);
      state.cargo[goodId] -= drop;
      excess -= drop;
      if (state.cargo[goodId] === 0) delete state.cargo[goodId];
    }
    // delivery jobs whose cargo no longer fits fail
    for (const j of deliveryCargo) {
      if (cargoUsed(state) > car.cargo) {
        j.status = 'failed';
      }
    }
    state.jobs.active = state.jobs.active.filter((j) => j.status !== 'failed');
  }
  state.carHealth = Math.min(state.carHealth, car.maxHealth);
  return { ok: true, dropped: Math.max(0, used - car.cargo) };
}

export function buyWeapon(state, weaponId) {
  const w = weapons[weaponId];
  if (!w) return { ok: false, reason: 'Unknown weapon' };
  const owned = state.ownedWeapons.includes(weaponId);
  if (!owned) {
    if (w.price > state.money) return { ok: false, reason: `Costs $${w.price} — you have $${state.money}.` };
    state.money -= w.price;
    state.stats.spent += w.price;
    state.ownedWeapons.push(weaponId);
  }
  return { ok: true, owned };
}

export function assignMount(state, weaponId, side) {
  if (side !== 'left' && side !== 'right') return { ok: false, reason: 'Pick left or right mount.' };
  if (!state.ownedWeapons.includes(weaponId)) return { ok: false, reason: 'You do not own that weapon.' };
  const replaced = state.mounts[side];
  state.mounts[side] = weaponId;
  return { ok: true, replaced };
}

export function buyInsurance(state) {
  if (state.insurance) return { ok: false, reason: 'Already insured.' };
  if (eco.insurancePrice > state.money) {
    return { ok: false, reason: `Insurance costs $${eco.insurancePrice} — you have $${state.money}.` };
  }
  state.money -= eco.insurancePrice;
  state.stats.spent += eco.insurancePrice;
  state.insurance = true;
  return { ok: true };
}

// Battle outcome intents (combat systems report; these apply to GameState).

export function applyVictory(state, { xp, heal = 0, bountyReward = 0, kills = 0 }) {
  state.kills += kills;
  state.stats.battlesWon += 1;
  if (heal > 0) {
    state.carHealth = Math.min(carDef(state).maxHealth, state.carHealth + heal);
  }
  if (bountyReward > 0) {
    state.money += bountyReward;
    state.stats.earned += bountyReward;
  }
  const res = grantXp(state, xp);
  return { ok: true, ...res };
}

export function applyDefeat(state) {
  // spec: lose all cargo + 25% money (insurance waives money loss, not cargo),
  // respawn at last town with minimal health
  state.stats.battlesLost += 1;
  state.cargo = {};
  let lostMoney = 0;
  let usedInsurance = false;
  if (state.insurance) {
    state.insurance = false;
    usedInsurance = true;
  } else {
    lostMoney = Math.floor(state.money * eco.defeatMoneyLoss);
    state.money -= lostMoney;
  }
  // delivery jobs fail with their cargo lost
  let failedJobs = 0;
  for (const j of state.jobs.active) {
    if (j.kind === 'delivery') {
      j.status = 'failed';
      failedJobs++;
    }
  }
  state.jobs.failed += failedJobs;
  state.jobs.active = state.jobs.active.filter((j) => j.status !== 'failed');
  state.carHealth = Math.max(1, Math.round(carDef(state).maxHealth * eco.respawnHealthFrac));
  return { ok: true, lostMoney, usedInsurance };
}

export function nextId() {
  return nextEntityId++;
}
