// Ambush strength scaling (spec: probability and strength scale with cargo
// value) and wave composition from a points budget (D8). Pure functions —
// seeded rng in, archetype list out.

import { enemies as enemyDefs } from './data/content.js';
import { combat as cbt } from './data/tuning.js';

export function ambushBudget({ cargoValue = 0, day = 1 } = {}) {
  const fromCargo = Math.min(cbt.budgetCap, cargoValue * cbt.budgetPerValue);
  const fromDay = Math.min(cbt.budgetDayCap, Math.max(0, day - 1) * cbt.budgetPerDay);
  return Math.round(cbt.budgetBase + fromCargo + fromDay);
}

export function ambushChance({ cargoValue = 0 } = {}) {
  return Math.min(cbt.ambushChanceCap, cbt.ambushBaseChance + cargoValue * cbt.ambushChancePerValue);
}

// Spend a points budget on archetypes: scouts 2, gunners 3, bruisers 4.
// Heavies weigh in when the budget is deep; `forced` entries (bounty
// targets) come first and are always present.
export function composeWave(budget, rng, { maxEnemies = cbt.maxEnemies, forced = [] } = {}) {
  const comp = [...forced];
  let left =
    budget - forced.reduce((s, f) => s + (enemyDefs[f.archetype]?.cost ?? 2), 0);
  const pool = ['scout', 'gunner', 'bruiser'];
  while (left >= 2 && comp.length < maxEnemies) {
    const affordable = pool.filter((a) => enemyDefs[a].cost <= left);
    if (!affordable.length) break;
    let pick;
    if (left >= 6 && rng.chance(0.45)) {
      const heavies = affordable.filter((a) => a !== 'scout');
      pick = heavies.length ? rng.pick(heavies) : rng.pick(affordable);
    } else {
      pick = rng.pick(affordable);
    }
    comp.push(pick);
    left -= enemyDefs[pick].cost;
  }
  return comp;
}

// Format a wave comp as arena wave objects.
export function toWaveSpec(comp, label) {
  return { label, comp: comp.map((c) => (typeof c === 'string' ? c : { ...c })) };
}
