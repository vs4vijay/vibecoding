// Job board logic (6.5): delivery runs (cargo to a destination town) and
// bounties (named target ambushed on the road). Generation is seeded per town
// + day-window so boards are stable between visits.

import { towns, jobTemplates, goods } from './data/content.js';
import { economy as eco } from './data/tuning.js';
import { createRng, hashSeed } from './rng.js';
import { findRoute } from './travel.js';
import { cargoUsed, cargoCapacity } from './state.js';

let jobSeq = 1;

// Board generation: deterministic for (seed, town, refresh-window).
export function generateBoard(state, townId) {
  const window = Math.floor((state.day - 1) / eco.jobRefreshDays);
  const rng = createRng(hashSeed('jobs', state.seed, townId, window));
  const other = Object.keys(towns).find((t) => t !== townId);
  const board = [];

  const deliveries = rng.int(1, 2);
  for (let i = 0; i < deliveries; i++) {
    const goodId = rng.pick(jobTemplates.delivery.cargoChoices);
    const units = rng.int(2, 5);
    const route = findRoute(townId, other);
    const days = route?.days ?? 1;
    const value = goods[goodId].base * units;
    const reward = Math.round(
      value * 0.55 + units * days * jobTemplates.delivery.rewardPerUnitPerDay
    );
    board.push({
      id: `job${jobSeq++}`,
      kind: 'delivery',
      goodId,
      units,
      fromTown: townId,
      toTown: other,
      reward,
    });
  }

  if (rng.chance(0.75)) {
    const route = findRoute(townId, other);
    const days = route?.days ?? 1;
    board.push({
      id: `job${jobSeq++}`,
      kind: 'bounty',
      name: rng.pick(jobTemplates.bounty.targetNames),
      archetype: rng.chance(0.4) ? 'gunner' : 'bruiser',
      reward: jobTemplates.bounty.rewardBase + days * jobTemplates.bounty.rewardPerDay,
    });
  }
  return board;
}

// Intent: accept a job from the board.
export function acceptJob(state, job) {
  const active = state.jobs.active.find((j) => j.id === job.id);
  if (active) return { ok: false, reason: 'Already taken.' };
  if (state.jobs.active.length >= 3) return { ok: false, reason: 'Too many jobs on the books (max 3).' };
  if (job.kind === 'delivery') {
    const free = cargoCapacity(state) - cargoUsed(state);
    if (job.units > free) {
      return { ok: false, reason: `Needs ${job.units} cargo space — only ${free} free.` };
    }
    state.cargo[job.goodId] = (state.cargo[job.goodId] || 0) + job.units;
  }
  state.jobs.active.push({ ...job, status: 'active' });
  return { ok: true };
}

// Intent: abandon an active job (delivery cargo stays in the hold).
export function abandonJob(state, jobId) {
  const job = state.jobs.active.find((j) => j.id === jobId);
  if (!job) return { ok: false, reason: 'Not yours.' };
  state.jobs.active = state.jobs.active.filter((j) => j.id !== jobId);
  if (job.kind === 'delivery') {
    // job cargo is forfeit — remove up to its units
    let left = job.units;
    const have = state.cargo[job.goodId] ?? 0;
    const drop = Math.min(have, left);
    if (drop > 0) {
      state.cargo[job.goodId] -= drop;
      if (state.cargo[job.goodId] === 0) delete state.cargo[job.goodId];
    }
    state.jobs.failed += 1;
  }
  return { ok: true };
}

// Call on arriving at a town: pays out completed deliveries.
export function settleArrivals(state, townId) {
  const paid = [];
  for (const j of state.jobs.active) {
    if (j.kind === 'delivery' && j.toTown === townId) {
      // job cargo unloaded with the client
      const have = state.cargo[j.goodId] ?? 0;
      const unload = Math.min(have, j.units);
      if (unload > 0) {
        state.cargo[j.goodId] -= unload;
        if (state.cargo[j.goodId] === 0) delete state.cargo[j.goodId];
      }
      state.money += j.reward;
      state.stats.earned += j.reward;
      state.jobs.completed += 1;
      paid.push({ name: `${j.units} ${goods[j.goodId].name} → ${towns[townId].name}`, reward: j.reward });
      j.status = 'done';
    }
  }
  state.jobs.active = state.jobs.active.filter((j) => j.status === 'done' ? false : true);
  return paid;
}

// Call after winning an ambush: pays bounties whose target was in it.
export function settleBounties(state, bountyName) {
  if (!bountyName) return null;
  const job = state.jobs.active.find((j) => j.kind === 'bounty' && j.name === bountyName);
  if (!job) return null;
  state.money += job.reward;
  state.stats.earned += job.reward;
  state.jobs.completed += 1;
  state.jobs.active = state.jobs.active.filter((j) => j !== job);
  return { name: bountyName, reward: job.reward };
}

// The bounty that forces the next ambush (one at a time).
export function activeBounty(state) {
  return state.jobs.active.find((j) => j.kind === 'bounty') ?? null;
}
