import { describe, it, expect } from 'vitest';
import { samplePose, ClipPlayer } from '../../src/actors/clips';
import { BASE_POSE, CLIPS } from '../../src/actors/clipsData';
import { buildRig } from '../../src/actors/skeleton';
import { SPECIES } from '../../src/data/species';
function makePose() {
    return {
        pelvis: [9, 9, 9], spine: [9, 9, 9], head: [9, 9, 9],
        armLU: [9, 9, 9], armLL: [9, 9, 9], armRU: [9, 9, 9], armRL: [9, 9, 9],
        legLU: [9, 9, 9], legLL: [9, 9, 9], legRU: [9, 9, 9], legRL: [9, 9, 9],
    };
}
describe('samplePose', () => {
    it('returns key-0 pose (base-filled) at t=0', () => {
        const out = makePose();
        samplePose(CLIPS.idle, 0, out);
        expect(out.pelvis[0]).toBeCloseTo(BASE_POSE.pelvis[0]);
        expect(out.spine[0]).toBeCloseTo(BASE_POSE.spine[0]);
    });
    it('eases monotonically between two keys', () => {
        // idle pelvis x: 0 at t=0, 0.02 at t=1200
        const early = makePose();
        const late = makePose();
        samplePose(CLIPS.idle, 300, early);
        samplePose(CLIPS.idle, 900, late);
        expect(early.pelvis[0]).toBeGreaterThan(0);
        expect(early.pelvis[0]).toBeLessThan(late.pelvis[0]);
        expect(late.pelvis[0]).toBeLessThan(0.02);
    });
    it('clamps past durMs to the final key', () => {
        const out = makePose();
        samplePose(CLIPS.roll, CLIPS.roll.durMs + 500, out);
        // roll's last key is an unwind ≈ base pose; pelvis x ≈ 0.05
        expect(out.pelvis[0]).toBeCloseTo(0.05, 5);
    });
    it('fills bones absent from both keys with BASE_POSE', () => {
        // punchR only authors spine/head/armR*: legLU must be base.
        const out = makePose();
        samplePose(CLIPS.punchR, 110, out);
        expect(out.legLU[0]).toBeCloseTo(BASE_POSE.legLU[0]);
        expect(out.armRU[0]).not.toBeCloseTo(BASE_POSE.armRU[0]);
    });
});
describe('ClipPlayer', () => {
    it('plays a one-shot and reports finished after durMs', () => {
        const p = new ClipPlayer();
        p.playRaw('punchR');
        expect(p.current).toBe('punchR');
        expect(p.finished).toBe(false);
        p.update(160);
        expect(p.finished).toBe(false);
        p.update(200);
        expect(p.finished).toBe(true);
    });
    it('keeps looping clips alive past durMs', () => {
        const p = new ClipPlayer();
        p.playRaw('run');
        p.update(CLIPS.run.durMs * 3 + 7);
        expect(p.finished).toBe(false);
        expect(p.timeMs).toBeLessThan(CLIPS.run.durMs);
    });
    it('crossfades without snapping: pose starts at old clip, ends at new', () => {
        const rig = buildRig(SPECIES.rabbit);
        const p = new ClipPlayer();
        p.playRaw('idle');
        p.update(500);
        p.applyTo(rig);
        const before = rig.bones.armLU.rotation.x;
        p.play('run'); // default 120ms fade
        p.update(1);
        p.applyTo(rig);
        const justAfter = rig.bones.armLU.rotation.x;
        expect(Math.abs(justAfter - before)).toBeLessThan(0.05);
        for (let i = 0; i < 20; i++)
            p.update(16.7); // > fade window
        p.applyTo(rig);
        const settled = makePose();
        samplePose(CLIPS.run, p.timeMs, settled);
        expect(rig.bones.armLU.rotation.x).toBeCloseTo(settled.armLU[0], 2);
    });
    it('retires the underlying layer once the fade completes', () => {
        const p = new ClipPlayer();
        p.playRaw('idle');
        p.update(300);
        p.play('crouchWalk');
        for (let i = 0; i < 30; i++)
            p.update(16.7);
        // Composite must equal pure crouchWalk sampling now.
        const rig = buildRig(SPECIES.rabbit);
        p.applyTo(rig);
        const want = makePose();
        samplePose(CLIPS.crouchWalk, p.timeMs, want);
        expect(rig.bones.spine.rotation.x).toBeCloseTo(want.spine[0], 3);
    });
    it('restarting the current clip snaps instead of self-fading', () => {
        const rig = buildRig(SPECIES.rabbit);
        const p = new ClipPlayer();
        p.playRaw('run');
        p.update(230); // mid-stride
        p.applyTo(rig);
        const before = rig.bones.legLU.rotation.x;
        p.play('run');
        p.update(0.001);
        p.applyTo(rig);
        // New layer starts at t≈0 of run, but with zero fade it writes fully:
        // pose jumps to run@0 immediately rather than blending with run@230.
        const atZero = makePose();
        samplePose(CLIPS.run, 0, atZero);
        expect(rig.bones.legLU.rotation.x).toBeCloseTo(atZero.legLU[0], 3);
        void before;
    });
});
describe('clip data integrity', () => {
    it('every named clip has ascending key times within durMs', () => {
        for (const [name, clip] of Object.entries(CLIPS)) {
            expect(clip.keys.length, name).toBeGreaterThan(0);
            expect(clip.keys[0].t, name).toBe(0);
            let prev = -1;
            for (const k of clip.keys) {
                expect(k.t, name).toBeGreaterThan(prev);
                expect(k.t, name).toBeLessThanOrEqual(clip.durMs);
                prev = k.t;
            }
            expect(clip.keys.length, `${name} key count`).toBeLessThanOrEqual(6);
        }
    });
    it('looping clips end where they start (wrap seam)', () => {
        for (const [name, clip] of Object.entries(CLIPS)) {
            if (!clip.loop)
                continue;
            const first = makePose();
            const last = makePose();
            samplePose(clip, 0, first);
            samplePose(clip, clip.durMs, last);
            for (const b of Object.keys(first)) {
                expect(last[b][0], `${name}.${b} x`).toBeCloseTo(first[b][0], 5);
                expect(last[b][1], `${name}.${b} y`).toBeCloseTo(first[b][1], 5);
                expect(last[b][2], `${name}.${b} z`).toBeCloseTo(first[b][2], 5);
            }
        }
    });
});
