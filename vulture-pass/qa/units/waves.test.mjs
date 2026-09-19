// Tasks 4.1/4.3 verification: budget scaling with cargo value and wave
// composition from a points budget.

import assert from 'node:assert/strict';
import { ambushBudget, ambushChance, composeWave } from '../../src/game/waves.js';
import { enemies as enemyDefs } from '../../src/game/data/content.js';
import { createRng } from '../../src/game/rng.js';

// scaling: loaded trips draw a bigger budget + higher chance
const empty = ambushBudget({ cargoValue: 0, day: 1 });
const loaded = ambushBudget({ cargoValue: 600, day: 1 });
const fat = ambushBudget({ cargoValue: 2000, day: 10 });
console.log(`budget: empty=${empty} loaded($600)=${loaded} fat($2000,d10)=${fat}`);
assert.ok(loaded > empty, 'loaded budget > empty budget');
assert.ok(fat > loaded, 'richer cargo + later day raises budget further');
assert.ok(ambushChance({ cargoValue: 2000 }) > ambushChance({ cargoValue: 0 }), 'loaded trip has higher ambush chance');

// composition respects costs and caps
{
  const rng = createRng(42);
  const comp = composeWave(12, rng);
  const spent = comp.reduce((s, a) => s + enemyDefs[a].cost, 0);
  console.log(`budget 12 -> [${comp.join(', ')}] (spent ${spent})`);
  assert.ok(spent <= 12 && spent >= 10, 'spends the budget without exceeding it');
  assert.ok(comp.length <= 8, 'respects enemy cap');
}
// big budgets bring variety: over several seeds, heavies appear
{
  let sawBruiser = false;
  let sawGunner = false;
  for (let seed = 1; seed < 40; seed++) {
    const comp = composeWave(12, createRng(seed));
    if (comp.includes('bruiser')) sawBruiser = true;
    if (comp.includes('gunner')) sawGunner = true;
  }
  assert.ok(sawBruiser && sawGunner, 'deep budgets mix in bruisers and gunners');
}
// forced bounty targets always present
{
  const comp = composeWave(8, createRng(7), { forced: [{ archetype: 'bruiser', name: 'Two-Bit Tomás' }] });
  assert.equal(comp[0].name, 'Two-Bit Tomás', 'bounty target leads the wave');
  assert.ok(comp.includes('scout') || comp.includes('gunner') || comp.includes('bruiser', 1), 'support added around the target');
}

console.log('waves.test: OK — ambush scaling and wave composition behave per spec');
