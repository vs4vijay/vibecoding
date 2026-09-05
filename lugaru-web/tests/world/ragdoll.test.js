/**
 * Task 12 headless test — ragdolls, knives, drops.
 *
 * TDD: failing first (RED) → implement → pass (GREEN).
 *
 * All tests use a flat heightAt (`() => 0`) for deterministic physics.
 * Rapier WASM init happens once in a beforeAll.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../../src/world/physics';
import { spawnRagdoll } from '../../src/actors/ragdoll';
import { Projectiles } from '../../src/world/projectiles';
import { buildRig } from '../../src/actors/skeleton';
import { SPECIES } from '../../src/data/species';
const FLAT_HEIGHT = (_x, _z) => 0;
let world;
beforeAll(async () => {
    world = await PhysicsWorld.create(FLAT_HEIGHT);
});
describe('Ragdoll', () => {
    it('all bones fall below initial chest height after 60 steps', () => {
        const rig = buildRig(SPECIES.wolf);
        // Simulate a brief idle pose: controller puts root on ground.
        rig.root.position.set(0, 0, 0);
        for (const bone of Object.values(rig.bones))
            bone.updateMatrixWorld(true);
        // Record initial chest (spine) Y in world space.
        const spineWorld = rig.bones.spine.getWorldPosition(new THREE.Vector3());
        const initialChestY = spineWorld.y;
        // Spawn ragdoll with upward impulse — bones start near ground.
        const handle = spawnRagdoll(world, rig, {
            dir: { x: 0, y: 1, z: 0 },
            force: SPECIES.wolf.massKg * 3,
        });
        // Step 60 times (1 second at 60 Hz).
        for (let i = 0; i < 60; i++)
            world.step(1 / 60);
        handle.update();
        // Every bone Y must be below the initial chest height.
        for (const [name, pose] of Object.entries(handle.bones)) {
            expect(pose.pos.y, `bone ${name} should have fallen`).toBeLessThan(initialChestY + 0.5);
        }
    });
    it('ragdoll settles within 600 steps', () => {
        const rig = buildRig(SPECIES.wolf);
        rig.root.position.set(0, 0, 0);
        for (const bone of Object.values(rig.bones))
            bone.updateMatrixWorld(true);
        const handle = spawnRagdoll(world, rig, {
            dir: { x: 0, y: 1, z: 0 },
            force: SPECIES.wolf.massKg * 3,
        });
        let settled = false;
        for (let i = 0; i < 600; i++) {
            world.step(1 / 60);
            handle.update();
            if (handle.settled) {
                settled = true;
                break;
            }
        }
        expect(settled, 'ragdoll should settle within 600 steps').toBe(true);
    });
});
describe('Projectiles', () => {
    it('knife thrown at flat ground lands and reports rest position within bounds', () => {
        const proj = new Projectiles(world);
        const from = { x: -30, y: 5, z: 0 };
        const dir = { x: 1, y: 0.2, z: 0 }; // mostly horizontal
        const speed = 20;
        proj.throwKnife(from, dir, speed);
        let restEvent = null;
        // Step up to 10 seconds.
        for (let i = 0; i < 600; i++) {
            world.step(1 / 60);
            const events = proj.step(1000 / 60);
            for (const ev of events) {
                if (ev.type === 'rest' && ev.at) {
                    restEvent = { type: 'rest', at: ev.at };
                    break;
                }
            }
            if (restEvent)
                break;
        }
        expect(restEvent, 'knife should report rest event').not.toBeNull();
        expect(restEvent.at.x).toBeGreaterThanOrEqual(-60);
        expect(restEvent.at.x).toBeLessThanOrEqual(60);
        expect(restEvent.at.z).toBeGreaterThanOrEqual(-60);
        expect(restEvent.at.z).toBeLessThanOrEqual(60);
        expect(Math.abs(restEvent.at.y)).toBeLessThan(1); // flat ground = 0 ± small
    });
});
