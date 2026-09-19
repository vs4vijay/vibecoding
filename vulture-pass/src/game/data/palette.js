// Shared desert palette (D11). Every scene pulls colors from here so the whole
// game keeps one hue discipline. Plain hex strings — no three import, so data
// modules stay runnable in node for tooling.

export const palette = {
  // Ground / world
  sky: '#a8c4cf',
  horizon: '#e6cf9f',
  sandLight: '#d9bd85',
  sand: '#cfa96b',
  sandDark: '#b98e55',
  road: '#5c4a38',
  roadWorn: '#6d5947',
  roadLine: '#d8c79a',
  rock: '#8a6f4d',
  rockDark: '#6e5537',
  scrub: '#7d7a4a',
  shadow: '#3f2f1f',

  // Buildings / town
  adobe: '#cf9f6a',
  adobeDark: '#a97b4e',
  roofRust: '#8a4a2c',
  roofTar: '#4a3b2c',
  wood: '#7a5a38',
  awning: '#b3541e',

  // Vehicles — player is always cream+stripe, enemies share gang hues with a
  // per-archetype tint so classes read at a glance.
  playerBody: '#f2e3c2',
  playerStripe: '#b3541e',
  bossBody: '#2b1d12',
  bossTrim: '#c8a156',
  scoutBody: '#8f6a3f',
  bruiserBody: '#6e3b24',
  gunnerBody: '#55603a',
  burnt: '#26201a',

  // FX
  muzzle: '#ffd98a',
  tracer: '#ffe9b0',
  explosion: '#e07b2e',
  explosionCore: '#fff3d0',
  smoke: '#4a4038',
  hotspotTrade: '#4a7c3f',
  hotspotJobs: '#3f6f8a',
  hotspotGun: '#a03123',
  hotspotGarage: '#b3892c',
};

// Map (sepia paper) tones for the DOM/SVG overworld.
export const paper = {
  bg: '#e3cfa5',
  bgAlt: '#d6bd8c',
  line: '#6e4a2b',
  ink: '#2b1d12',
  road: '#8a6f4d',
  town: '#a97b4e',
  locked: '#9a8a72',
  accent: '#b3541e',
  marker: '#7a2d1d',
};

export default palette;
