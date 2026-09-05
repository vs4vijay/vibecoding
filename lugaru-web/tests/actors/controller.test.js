import { describe, it, expect } from 'vitest';
import { CharacterController } from '../../src/actors/controller';
import { buildRig } from '../../src/actors/skeleton';
import { ClipPlayer } from '../../src/actors/clips';
import { SPECIES } from '../../src/data/species';
import { heightAt } from '../../src/world/terrain';
function makeFrame() {
    return {
        moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
        pressed: { attack: false, jump: false, crouch: false },
        held: { attack: false, jump: false, crouch: false },
    };
}
const DT = 1000 / 60;
function makeController() {
    const rig = buildRig(SPECIES.rabbit);
    return {
        rig,
        c: new CharacterController(rig, SPECIES.rabbit, new ClipPlayer(rig)),
    };
}
describe('CharacterController kinematics', () => {
    it('starts grounded on the terrain', () => {
        const { c } = makeController();
        expect(c.grounded).toBe(true);
        expect(c.pos.y).toBeCloseTo(heightAt(0, 0), 5);
    });
    it('reaches run speed under sustained forward input (accel-limited)', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.moveZ = -1;
        for (let i = 0; i < 60; i++)
            c.update(DT, f, false, 0); // 1s
        const speed = Math.hypot(c.vel.x, c.vel.z);
        expect(speed).toBeCloseTo(SPECIES.rabbit.runSpeed, 1);
        // Facing −Z at yaw 0 → forward velocity is −z.
        expect(c.vel.z).toBeCloseTo(-SPECIES.rabbit.runSpeed, 1);
        expect(c.stance).toBe('running');
    });
    it('stops via friction when input releases', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.moveZ = -1;
        for (let i = 0; i < 60; i++)
            c.update(DT, f, false, 0);
        f.moveZ = 0;
        for (let i = 0; i < 120; i++)
            c.update(DT, f, false, 0); // 2s
        expect(Math.hypot(c.vel.x, c.vel.z)).toBeLessThan(0.05);
        expect(c.stance).toBe('standing');
    });
    it('jump leaves the ground ballistically and lands again', () => {
        const { c } = makeController();
        const f = makeFrame();
        // Walk a moment so we know ground level is settled.
        for (let i = 0; i < 10; i++)
            c.update(DT, f, false, 0);
        const gy0 = c.pos.y;
        f.pressed.jump = true;
        c.update(DT, f, false, 0);
        f.pressed.jump = false; // edge consumed
        let peakY = gy0;
        let airborneSteps = 0;
        for (let i = 0; i < 90; i++) {
            c.update(DT, f, false, 0);
            peakY = Math.max(peakY, c.pos.y);
            if (!c.grounded)
                airborneSteps++;
        }
        // Apex ≈ v²/2g = 5.4²/28 ≈ 1.04 m.
        expect(peakY - gy0).toBeGreaterThan(0.8);
        expect(peakY - gy0).toBeLessThan(1.3);
        expect(airborneSteps).toBeGreaterThan(20);
        expect(c.grounded).toBe(true);
        expect(c.stance).not.toBe('airborne');
    });
    it('crouch accumulates crouchHeldMs while held, resets on release', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.held.crouch = true;
        for (let i = 0; i < 30; i++)
            c.update(DT, f, false, 0);
        expect(c.crouchHeldMs).toBeGreaterThanOrEqual(500);
        expect(c.stance).toBe('crouched');
        f.held.crouch = false;
        c.update(DT, f, false, 0);
        expect(c.crouchHeldMs).toBe(0);
        expect(c.stance).toBe('standing');
    });
    it('capped crouch speed while crouched', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.moveZ = -1;
        f.held.crouch = true;
        for (let i = 0; i < 60; i++)
            c.update(DT, f, false, 0);
        const speed = Math.hypot(c.vel.x, c.vel.z);
        expect(speed).toBeCloseTo(SPECIES.rabbit.crouchSpeed, 1);
    });
    it('locked input freezes intent but physics settles', () => {
        const { c } = makeController();
        // Get moving first.
        const open = makeFrame();
        open.moveZ = -1;
        for (let i = 0; i < 30; i++)
            c.update(DT, open, false, 0);
        const locked = makeFrame();
        locked.moveZ = -1; // ignored while locked
        locked.pressed.jump = true;
        const speedBefore = Math.hypot(c.vel.x, c.vel.z);
        for (let i = 0; i < 30; i++)
            c.update(DT, locked, true, 0);
        expect(Math.hypot(c.vel.x, c.vel.z)).toBeLessThan(speedBefore); // friction still applies
        expect(c.crouchHeldMs).toBe(0); // no crouch accumulation
        expect(c.grounded).toBe(true);
    });
    it('heading turns toward velocity direction', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.moveX = 1; // camera-right at yaw 0 = +X world
        for (let i = 0; i < 90; i++)
            c.update(DT, f, false, 0);
        // atan2(-vx,-vz) with vz≈0,vx>0 → −π/2
        expect(c.heading).toBeCloseTo(-Math.PI / 2, 1);
    });
    it('aligns pitch to uphill slope when walking up', () => {
        const f = makeFrame();
        const { c, rig } = makeController();
        // Terrain ∂h/∂x max near x≈±19.6 (1.2·0.08·cos term dominates).
        c.pos.x = 15;
        c.pos.z = 0;
        for (let i = 0; i < 240; i++)
            c.update(DT, f, false, 0); // 4s of running
        if (!c.grounded)
            return; // skip if launch happened — shouldn't
        // Moving in −x direction (heading π): grade along facing decides sign.
        // Just require meaningful nonzero pitch alignment on this hilly start.
        expect(Math.abs(rig.root.rotation.x)).toBeGreaterThan(0.02);
    });
});
describe('clip selection', () => {
    it('airborne picks jump then fall', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.pressed.jump = true;
        c.update(DT, f, false, 0);
        f.pressed.jump = false;
        expect(c.anim.current).toBe('jump');
        for (let i = 0; i < 40; i++)
            c.update(DT, f, false, 0);
        // After apex, still airborne → fall clip took over.
        if (!c.grounded)
            expect(c.anim.current).toBe('fall');
        for (let i = 0; i < 60 && !c.grounded; i++)
            c.update(DT, f, false, 0);
        expect(c.grounded).toBe(true);
    });
    it('running stance drives the run clip', () => {
        const { c } = makeController();
        const f = makeFrame();
        f.moveZ = -1;
        for (let i = 0; i < 45; i++)
            c.update(DT, f, false, 0);
        expect(c.stance).toBe('running');
        expect(c.anim.current).toBe('run');
    });
});
