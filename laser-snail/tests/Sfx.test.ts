import { describe, expect, it } from 'vitest';

import { Sfx } from '../src/audio/Sfx';

/**
 * The mute contract (Phase 5 audio pass): every voice funnels through the
 * same gated `tone` path, so the persisted mute flag silences *everything*.
 * There is no AudioContext in the node test environment — which is exactly
 * the point: every method must stay a graceful no-op there.
 */

describe('Sfx', () => {
  it('is unmuted by default and tracks the persisted mute flag', () => {
    const sfx = new Sfx();
    expect(sfx.muted).toBe(false);
    sfx.setMuted(true);
    expect(sfx.muted).toBe(true);
    sfx.setMuted(false);
    expect(sfx.muted).toBe(false);
  });

  it('every voice is a safe no-op headless (no context, muted or not)', () => {
    const sfx = new Sfx();
    sfx.resume(); // no AudioContext in node → flagged unavailable, must not throw

    expect(() => {
      sfx.pickup();
      sfx.heart();
      sfx.damage();
      sfx.death();
      sfx.finish('gold');
      sfx.finish('silver');
      sfx.finish('bronze');
      sfx.finish('none');
      sfx.unlock();
      sfx.unlock(0.7);
      sfx.move();
      sfx.shoot('bolt');
      sfx.shoot('laser');
      sfx.shoot('rocket');
      sfx.explosion();
      sfx.bomb();
      sfx.ladderUp();
      sfx.whoosh();
      sfx.land();
      sfx.alarm();
    }).not.toThrow();

    sfx.dispose();
  });

  it('stays silent-when-muted: toggling never throws and all voices stay gated', () => {
    const sfx = new Sfx();
    sfx.resume();
    sfx.setMuted(true);
    expect(() => {
      sfx.finish('gold');
      sfx.unlock();
      sfx.move();
      sfx.bomb();
    }).not.toThrow();
    sfx.setMuted(false);
    expect(() => sfx.finish('bronze')).not.toThrow();
    sfx.dispose();
  });
});
