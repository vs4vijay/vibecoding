// Overworld travel flow (5.2): plan a trip between directly connected nodes,
// consume days, roll a seeded ambush. Pure logic — the map UI and main flow
// orchestrate around it.

import { region } from './data/content.js';
import { ambushBudget, ambushChance } from './waves.js';
import { createRng, hashSeed } from './rng.js';
import { cargoValue } from './state.js';

export function findRoute(aId, bId) {
  return region.routes.find(
    (r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId)
  );
}

export function connectionsFor(nodeId) {
  return region.routes
    .filter((r) => r.a === nodeId || r.b === nodeId)
    .map((r) => ({ to: r.a === nodeId ? r.b : r.a, route: r }));
}

// Plan (does not mutate). Returns null if no direct road; {blocked, reason}
// for boss-gated routes before victory.
export function planTrip(state, toId) {
  if (state.location.kind !== 'town') return { blocked: true, reason: 'Not in a town.' };
  const fromId = state.location.townId;
  if (fromId === toId) return { blocked: true, reason: 'Already there.' };
  const route = findRoute(fromId, toId);
  if (!route) return { blocked: true, reason: 'No direct road.' };
  if (route.gate === 'boss' && !state.bossDefeated) {
    return { blocked: true, reason: 'The North Pass is locked — the Buzzard holds the Basin.', gate: true };
  }

  const value = cargoValue(state);
  const bounty = state.jobs.active.find((j) => j.kind === 'bounty' && !j.fulfilled);
  const isBossNode = region.nodes[toId]?.kind === 'boss';

  return {
    ok: true,
    fromId,
    toId,
    days: route.days,
    road: route.road,
    cargoValue: value,
    chance: bounty ? 1 : ambushChance({ cargoValue: value, day: state.day }),
    budget: ambushBudget({ cargoValue: value, day: state.day }),
    forcedBounty: bounty ? bounty.name : null,
    isBossNode,
  };
}

// Consume the trip's days and roll the ambush with a trip-indexed seed.
// Mutates state (day, trips). Returns { ambush: boolean, bountyName? }.
export function rollTrip(state, trip) {
  state.day += trip.days;
  state.trips += 1;
  const rng = createRng(hashSeed(state.seed, 'trip', state.trips, trip.toId));
  let ambush;
  if (trip.forcedBounty) ambush = true;
  else if (trip.isBossNode) ambush = true; // the boss fight is the destination
  else ambush = rng.chance(trip.chance);
  return { ambush, bountyName: trip.forcedBounty ?? null };
}
