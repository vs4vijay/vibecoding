import * as THREE from 'three';
/**
 * Procedural hare rig (Lugaru-style upright stance).
 *
 * Each bone is a Group at its joint origin with a child box along local Y
 * translated ∓len/2, so euler rotation always pivots at the joint: `down`
 * bones (limbs) hang below their joint, `up` bones (trunk, neck) rise above
 * it. Pose clips author absolute eulers, so the baked neutral below is just
 * a sane pre-pose default; the idle clip is authoritative at runtime.
 *
 * Frame: root sits on the ground point, character faces −Z at heading 0;
 * root.rotation.order is 'YXZ' so controller can combine yaw (heading) with
 * slope pitch/roll without extra nesting.
 */
export function buildRig(def) {
    const mat = new THREE.MeshStandardMaterial({
        color: def.colors.fur,
        flatShading: true,
    });
    function makeBone(name, len, up, thickness = 1) {
        const joint = new THREE.Group();
        joint.name = name;
        const w = len * 0.45 * thickness;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
        mesh.position.y = up ? len / 2 : -len / 2;
        mesh.castShadow = true;
        joint.add(mesh);
        return joint;
    }
    const { armUpper, armLower, legUpper, legLower } = def.limbLens;
    const chestLen = def.torsoLen * 0.35;
    const root = new THREE.Group();
    root.name = `${def.id}-rig`;
    root.rotation.order = 'YXZ';
    const bones = {};
    const boneLen = {};
    // Trunk rises from the hip joint; chest + head continue at the top.
    const pelvis = makeBone('pelvis', def.torsoLen, true, 1.8);
    pelvis.position.y = def.hipHeight;
    root.add(pelvis);
    bones.pelvis = pelvis;
    boneLen.pelvis = def.torsoLen;
    const spine = makeBone('spine', chestLen, true, 1.6);
    spine.position.y = def.torsoLen;
    pelvis.add(spine);
    bones.spine = spine;
    boneLen.spine = chestLen;
    const head = makeBone('head', 0.22, true, 1.7);
    head.position.y = chestLen;
    spine.add(head);
    bones.head = head;
    boneLen.head = 0.22;
    // Limbs hang from their joints; elbows/knees chain at the far end.
    const sideX = 0.09;
    for (const side of [1, -1]) {
        const sfx = side > 0 ? 'L' : 'R';
        const armU = makeBone(`arm${sfx}U`, armUpper, false);
        armU.rotation.x = Math.PI; // neutral: straight down
        armU.position.set(sideX * side, chestLen * 0.8, -def.torsoLen * 0.18);
        spine.add(armU);
        bones[`arm${sfx}U`] = armU;
        boneLen[`arm${sfx}U`] = armUpper;
        const armL = makeBone(`arm${sfx}L`, armLower, false);
        armL.rotation.x = Math.PI;
        armL.position.y = -armUpper;
        armU.add(armL);
        bones[`arm${sfx}L`] = armL;
        boneLen[`arm${sfx}L`] = armLower;
        const legU = makeBone(`leg${sfx}U`, legUpper, false);
        legU.rotation.x = Math.PI;
        legU.position.set(sideX * side, 0, def.torsoLen * 0.15);
        pelvis.add(legU);
        bones[`leg${sfx}U`] = legU;
        boneLen[`leg${sfx}U`] = legUpper;
        const legL = makeBone(`leg${sfx}L`, legLower, false);
        legL.rotation.x = Math.PI;
        legL.position.y = -legUpper;
        legU.add(legL);
        bones[`leg${sfx}L`] = legL;
        boneLen[`leg${sfx}L`] = legLower;
    }
    return { root, bones, boneLen };
}
