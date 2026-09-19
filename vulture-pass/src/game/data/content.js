// Content registries (D6 — code-free balancing). Plain data, no three/DOM
// imports, so these modules stay node-runnable for audits and tuning tools.
//
// All names, places, and flavor text are original IP for this homage. Nothing
// here references the 2005 commercial game that inspired the genre.

// ---------------------------------------------------------------- cars

export const cars = {
  mule: {
    id: 'mule',
    name: 'Mule',
    flavor: 'A tired farm sedan that refuses to die. Refuses to hurry, too.',
    price: 400,
    maxHealth: 70,
    topSpeed: 26, // sim units/s on road
    accel: 19,
    turnRate: 2.15, // rad/s at full steer
    grip: 7.0, // lateral velocity decay per second (higher = stickier)
    offroad: 0.55, // top-speed multiplier off road
    cargo: 10,
    length: 4.4,
    width: 2.2,
  },
  sidewinder: {
    id: 'sidewinder',
    name: 'Sidewinder',
    flavor: 'Stripped to the frame for speed. Barely fits a tool chest.',
    price: 900,
    maxHealth: 60,
    topSpeed: 37,
    accel: 27,
    turnRate: 2.6,
    grip: 9.0,
    offroad: 0.42,
    cargo: 5,
    length: 4.2,
    width: 2.0,
  },
  armadillo: {
    id: 'armadillo',
    name: 'Armadillo',
    flavor: 'Plated junker from the scrap fields. Slow, and proud of it.',
    price: 1400,
    maxHealth: 150,
    topSpeed: 23,
    accel: 16,
    turnRate: 1.8,
    grip: 6.5,
    offroad: 0.68,
    cargo: 16,
    length: 4.8,
    width: 2.5,
  },
  longhorn: {
    id: 'longhorn',
    name: 'Longhorn',
    flavor: 'A war-surplus hauler. Everything fits, nothing catches it empty.',
    price: 2200,
    maxHealth: 115,
    topSpeed: 30,
    accel: 21,
    turnRate: 1.95,
    grip: 7.0,
    offroad: 0.6,
    cargo: 22,
    length: 5.4,
    width: 2.6,
  },
};

export const starterCarId = 'mule';

// ---------------------------------------------------------------- weapons

export const weapons = {
  pistol: {
    id: 'pistol',
    name: 'Rattler Pistol',
    class: 'pistol',
    flavor: 'Honest iron. Slow, straight, always loaded eventually.',
    price: 120,
    kind: 'hitscan', // instant ray
    damage: 9,
    pellets: 1,
    spreadDeg: 1.2,
    range: 55,
    reload: 0.85, // seconds
    tracer: true,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Dust Devil',
    class: 'shotgun',
    flavor: 'Road-sweeper. Conversation ender at ten paces.',
    price: 450,
    kind: 'hitscan',
    damage: 5,
    pellets: 6,
    spreadDeg: 13,
    range: 26,
    reload: 1.7,
    tracer: true,
  },
  mg: {
    id: 'mg',
    name: 'Hornet Gun',
    class: 'machinegun',
    flavor: 'A crate-fed hornet nest. Bites in bursts.',
    price: 800,
    kind: 'burst',
    damage: 4,
    pellets: 1,
    burst: 8, // shots per trigger
    burstGap: 0.085,
    spreadDeg: 3.5,
    range: 48,
    reload: 2.4,
    tracer: true,
  },
  rocket: {
    id: 'rocket',
    name: 'Mule-Kick Launcher',
    class: 'rocket',
    flavor: 'One kick turns a roadblock into a rumor.',
    price: 1200,
    kind: 'projectile',
    damage: 40,
    splashRadius: 8,
    splashMin: 0.25, // damage fraction at splash edge
    projectileSpeed: 44,
    reload: 3.0,
  },
};

export const starterWeaponId = 'pistol';

// ---------------------------------------------------------------- goods

export const goods = {
  water: { id: 'water', name: 'Water Casks', base: 12 },
  scrap: { id: 'scrap', name: 'Scrap Metal', base: 22 },
  liquor: { id: 'liquor', name: 'Cactus Liquor', base: 30 },
  fuel: { id: 'fuel', name: 'Fuel Drums', base: 38 },
  medicine: { id: 'medicine', name: 'Medicine Kits', base: 60 },
};

// ---------------------------------------------------------------- towns

export const towns = {
  polvo: {
    id: 'polvo',
    name: 'Polvo',
    flavor: 'Dust farms and a dry well. Doc rows cots in the back of the general store.',
    priceMod: { water: 0.9, medicine: 0.7, fuel: 1.25, scrap: 1.0, liquor: 0.95 },
    produces: ['medicine', 'water'],
  },
  copperWells: {
    id: 'copperWells',
    name: 'Copper Wells',
    flavor: 'Headframe town. Cheap fuel, dear medicine, short tempers.',
    priceMod: { water: 1.15, medicine: 1.4, fuel: 0.8, scrap: 0.75, liquor: 1.1 },
    produces: ['fuel', 'scrap'],
  },
};

// ---------------------------------------------------------------- region map

// Nodes and routes for the overworld (D4). `routeGate` routes are locked until
// the boss flag flips.
export const region = {
  id: 'chollaBasin',
  name: 'Cholla Basin',
  nodes: {
    polvo: { id: 'polvo', kind: 'town', x: 22, y: 62 },
    copperWells: { id: 'copperWells', kind: 'town', x: 78, y: 40 },
    buzzardsRoost: { id: 'buzzardsRoost', kind: 'boss', x: 52, y: 14 },
    northPass: { id: 'northPass', kind: 'gate', x: 50, y: 92 },
  },
  routes: [
    { a: 'polvo', b: 'copperWells', days: 1, road: 'Route 9' },
    { a: 'polvo', b: 'buzzardsRoost', days: 1, road: 'Buzzard Trail' },
    { a: 'copperWells', b: 'buzzardsRoost', days: 1, road: 'Wire Road' },
    { a: 'polvo', b: 'northPass', days: 2, road: 'North Pass', gate: 'boss' },
  ],
};

// ---------------------------------------------------------------- jobs

// Templates the job board rolls from (seeded per town, refreshed every few
// days). Rewards scale with distance and haul size.
export const jobTemplates = {
  delivery: {
    id: 'delivery',
    kind: 'delivery',
    rewardPerUnitPerDay: 26,
    cargoChoices: ['water', 'scrap', 'liquor', 'fuel', 'medicine'],
  },
  bounty: {
    id: 'bounty',
    kind: 'bounty',
    rewardBase: 240,
    rewardPerDay: 45,
    targetNames: [
      'Two-Bit Tomás',
      'Fat Crickets',
      'Loco Bruno',
      'Half-Rooster Ruiz',
      'Sighing Sal',
      'Dust Chaplain',
    ],
  },
};

// ---------------------------------------------------------------- boss

export const boss = {
  id: 'buzzard',
  name: 'The Buzzard',
  title: 'Boss of the Carrion Boys',
  car: 'Longhorn rigged with plates and pride',
  maxHealth: 420,
  topSpeed: 33,
  accel: 24,
  turnRate: 2.1,
  grip: 8,
  offroad: 0.65,
  phase2At: 0.5, // health fraction where the fight changes
  phase2Speed: 40,
  xp: 150,
  waves: [
    { label: 'First pickings', comp: ['scout', 'scout', 'gunner'] },
    { label: 'The muscle rolls in', comp: ['bruiser', 'scout', 'scout'] },
    { label: 'Last of the flock', comp: ['bruiser', 'bruiser', 'gunner'] },
  ],
  reward: 1200,
};

// ---------------------------------------------------------------- enemies

export const enemies = {
  scout: {
    id: 'scout',
    archetype: 'scout',
    cost: 2,
    xp: 12,
    maxHealth: 35,
    topSpeed: 27,
    accel: 20,
    turnRate: 2.4,
    grip: 8,
    weapon: 'enemyPistol',
  },
  bruiser: {
    id: 'bruiser',
    archetype: 'bruiser',
    cost: 4,
    xp: 22,
    maxHealth: 95,
    topSpeed: 24,
    accel: 17,
    turnRate: 1.7,
    grip: 6,
    weapon: 'enemyShotgun',
  },
  gunner: {
    id: 'gunner',
    archetype: 'gunner',
    cost: 3,
    xp: 18,
    maxHealth: 55,
    topSpeed: 26,
    accel: 19,
    turnRate: 2.0,
    grip: 7,
    weapon: 'enemyMg',
  },
};

// Internal enemy weapon stats (not for sale).
export const enemyWeapons = {
  enemyPistol: { kind: 'hitscan', damage: 5, pellets: 1, spreadDeg: 7, range: 42, reload: 1.7 },
  enemyShotgun: { kind: 'hitscan', damage: 4, pellets: 5, spreadDeg: 12, range: 15, reload: 2.2 },
  enemyMg: { kind: 'burst', damage: 3, pellets: 1, burst: 5, burstGap: 0.11, spreadDeg: 5, range: 38, reload: 2.6 },
};

// ---------------------------------------------------------------- cutscenes

// Panel scripts for the comic system (8.2). `art` drives placeholder SVG
// shapes (mesa / car / road / town / buzzard / burst / text); real drawings
// replace these later without touching the player code. All original IP.
export const cutscenes = {
  opening: {
    id: 'opening',
    title: 'Vulture Pass',
    panels: [
      {
        caption: 'Cholla Basin, 1927. The wells ran bitter, the mines ran out, and the only thing still growing was trouble.',
        art: {
          sky: '#e3b877',
          shapes: [
            { type: 'mesa', x: 40 },
            { type: 'mesa', x: 118 },
            { type: 'road' },
            { type: 'star', x: 24, y: 16 },
            { type: 'star', x: 142, y: 34 },
          ],
        },
      },
      {
        caption: 'Then the Carrion Boys rode down out of the Roost and took the Basin for their own.',
        art: {
          sky: '#c99a5c',
          shapes: [
            { type: 'mesa', x: 130 },
            { type: 'car', x: 96, color: '#6e3b24', dust: true },
            { type: 'car', x: 120, color: '#8f6a3f', dust: true },
            { type: 'road' },
            { type: 'text', x: 46, y: 30, text: 'THE CARRION BOYS', size: 8, color: '#7a2d1d' },
          ],
        },
      },
      {
        caption: 'They burned the homesteads for fun and taxed the roads for a living. The law never came.',
        art: {
          sky: '#a86f42',
          shapes: [
            { type: 'town', x: 76, seed: 3 },
            { type: 'burst', x: 52, y: 52 },
            { type: 'road' },
            { type: 'text', x: 100, y: 28, text: 'NO LAW PAST THE WIRE', size: 7 },
          ],
        },
      },
      {
        caption: 'You came looking for the man who signed the order — the one they call the Buzzard. Time to collect.',
        art: {
          sky: '#8a5636',
          shapes: [
            { type: 'mesa', x: 34 },
            { type: 'car', x: 60, color: '#f2e3c2', dust: true },
            { type: 'buzzard', x: 118, y: 26 },
            { type: 'road' },
          ],
        },
      },
    ],
  },
  bossVictory: {
    id: 'bossVictory',
    title: 'The Buzzard Falls',
    panels: [
      {
        caption: 'The Buzzard\'s rig catches the dirt at full clip and rolls twice. The Basin holds its breath.',
        art: {
          sky: '#b87740',
          shapes: [
            { type: 'road' },
            { type: 'car', x: 66, color: '#2b1d12' },
            { type: 'burst', x: 116, y: 50 },
          ],
        },
      },
      {
        caption: '"Toll\'s paid," you tell him, "both ways." The Carrion Boys scatter like the birds they named themselves for.',
        art: {
          sky: '#d8b36a',
          shapes: [
            { type: 'mesa', x: 44 },
            { type: 'car', x: 20, color: '#8f6a3f', dust: true },
            { type: 'car', x: 44, color: '#6e3b24', dust: true },
            { type: 'buzzard', x: 122, y: 22 },
            { type: 'road' },
          ],
        },
      },
      {
        caption: 'By dusk the wire gate at the pass hangs open, and no one collects a toll on Cholla roads ever again.',
        art: {
          sky: '#7a4a34',
          shapes: [
            { type: 'star', x: 30, y: 14 },
            { type: 'star', x: 128, y: 20 },
            { type: 'star', x: 82, y: 10 },
            { type: 'town', x: 60, seed: 7 },
            { type: 'road' },
            { type: 'text', x: 80, y: 26, text: 'THE BASIN, FREE', size: 8, color: '#e8d5ae' },
          ],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------- registry index

export const registries = { cars, weapons, goods, towns, region, jobTemplates, boss, enemies, enemyWeapons, cutscenes };

export default registries;
