import { BASE_POSE, CLIPS } from './clipsData';
const BONE_NAMES = [
    'pelvis', 'spine', 'head',
    'armLU', 'armLL', 'armRU', 'armRL',
    'legLU', 'legLL', 'legRU', 'legRL',
];
const MAX_LAYERS = 4;
/** Cubic smoothstep easing on segment fractions. */
function ease(t) {
    return t * t * (3 - 2 * t);
}
/**
 * Samples `clip` at tMs into `out`: each surrounding key's partial pose is
 * merged over BASE_POSE, then per-bone eased lerp. Clamps outside key range.
 */
export function samplePose(clip, tMs, out) {
    const keys = clip.keys;
    const n = keys.length;
    if (n === 0)
        return;
    if (tMs <= keys[0].t) {
        resolveInto(keys[0].pose, out);
        return;
    }
    if (tMs >= keys[n - 1].t) {
        resolveInto(keys[n - 1].pose, out);
        return;
    }
    let i = 0;
    while (keys[i + 1].t <= tMs)
        i++;
    const k0 = keys[i];
    const k1 = keys[i + 1];
    const f = ease((tMs - k0.t) / (k1.t - k0.t));
    for (let b = 0; b < BONE_NAMES.length; b++) {
        const dst = out[BONE_NAMES[b]];
        const a = (k0.pose[BONE_NAMES[b]] ?? BASE_POSE[BONE_NAMES[b]]);
        const c = (k1.pose[BONE_NAMES[b]] ?? BASE_POSE[BONE_NAMES[b]]);
        dst[0] = a[0] + (c[0] - a[0]) * f;
        dst[1] = a[1] + (c[1] - a[1]) * f;
        dst[2] = a[2] + (c[2] - a[2]) * f;
    }
}
/** Resolve a key's partial pose over BASE_POSE (absent bones → base). */
function resolveInto(pose, out) {
    for (let b = 0; b < BONE_NAMES.length; b++) {
        const p = pose[BONE_NAMES[b]] ?? BASE_POSE[BONE_NAMES[b]];
        const dst = out[BONE_NAMES[b]];
        dst[0] = p[0];
        dst[1] = p[1];
        dst[2] = p[2];
    }
}
/**
 * Plays named clips from CLIPS onto a rig with weighted cross-fades.
 *
 * Layers stack newest-first; each keeps its own clock. A layer retires once
 * a newer layer has fully faded in over it (or when it was snapped in).
 * One-shots clamp at their last key until retired or replaced. All scratch
 * poses are preallocated — update() allocates nothing.
 */
export class ClipPlayer {
    /** Default cross-fade duration applied by play(). */
    fadeMs = 120;
    current = '';
    /** True when the top layer is a finished one-shot (or nothing plays). */
    finished = false;
    rig;
    targetPose;
    accPose;
    tmpPose;
    layers = [];
    nowMs = 0;
    constructor(rig) {
        this.rig = rig ?? null;
        this.targetPose = makePose();
        this.accPose = makePose();
        this.tmpPose = makePose();
    }
    /** Start `name`, cross-fading over `fadeMs ?? this.fadeMs`. */
    play(name, fadeMs) {
        const clip = CLIPS[name];
        if (!clip)
            return;
        // Restarting the already-current clip snaps instead of fading a ghost
        // of itself against itself.
        const snap = this.current === name;
        this.pushLayer(clip, snap ? 0 : fadeMs ?? this.fadeMs);
        this.current = name;
        this.finished = false;
    }
    /** Start `name` immediately with no fade (first pose of the game). */
    playRaw(name) {
        const clip = CLIPS[name];
        if (!clip)
            return;
        this.layers.length = 0;
        this.pushLayer(clip, 0);
        this.current = name;
        this.finished = false;
    }
    update(dtMs) {
        this.nowMs += dtMs;
        // Wrap loop clocks; retire a layer once the one above it has fully
        // faded in (checked on the COVERING layer's own clock).
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const L = this.layers[i];
            const local = this.nowMs - L.startMs;
            if (L.clip.loop && local >= L.clip.durMs) {
                L.startMs += Math.floor(local / L.clip.durMs) * L.clip.durMs;
            }
            if (i > 0 && this.nowMs - this.layers[i - 1].startMs >= this.layers[i - 1].fadeInMs) {
                this.layers.splice(i, 1);
            }
        }
        if (this.layers.length === 0) {
            this.finished = true;
            return;
        }
        const top = this.layers[0];
        const topLocal = this.nowMs - top.startMs;
        this.finished = !top.clip.loop && topLocal >= top.clip.durMs;
        // Blend oldest→newest so each layer eases in over the composite beneath
        // it: acc starts at the oldest sample; newer layers pull it toward
        // their own sample by their fade weight.
        const oldest = this.layers[this.layers.length - 1];
        samplePose(oldest.clip, this.nowMs - oldest.startMs, this.tmpPose);
        copyPose(this.tmpPose, this.accPose);
        for (let i = this.layers.length - 2; i >= 0; i--) {
            const L = this.layers[i];
            samplePose(L.clip, this.nowMs - L.startMs, this.tmpPose);
            const local = this.nowMs - L.startMs;
            const w = L.fadeInMs > 0 ? Math.min(1, local / L.fadeInMs) : 1;
            for (let b = 0; b < BONE_NAMES.length; b++) {
                const dst = this.accPose[BONE_NAMES[b]];
                const src = this.tmpPose[BONE_NAMES[b]];
                dst[0] += (src[0] - dst[0]) * w;
                dst[1] += (src[1] - dst[1]) * w;
                dst[2] += (src[2] - dst[2]) * w;
            }
        }
    }
    applyTo(rig) {
        const r = rig ?? this.rig;
        if (!r)
            return;
        for (let b = 0; b < BONE_NAMES.length; b++) {
            const p = this.accPose[BONE_NAMES[b]];
            r.bones[BONE_NAMES[b]].rotation.set(p[0], p[1], p[2]);
        }
    }
    /** Local clock of the top layer (0 when nothing is playing). */
    get timeMs() {
        return this.layers[0] ? this.nowMs - this.layers[0].startMs : 0;
    }
    pushLayer(clip, fadeInMs) {
        this.layers.unshift({ clip, startMs: this.nowMs, fadeInMs });
        if (this.layers.length > MAX_LAYERS)
            this.layers.length = MAX_LAYERS;
    }
}
function makePose() {
    const p = {};
    for (const n of BONE_NAMES)
        p[n] = [0, 0, 0];
    return p;
}
function copyPose(src, dst) {
    for (let b = 0; b < BONE_NAMES.length; b++) {
        const s = src[BONE_NAMES[b]];
        const d = dst[BONE_NAMES[b]];
        d[0] = s[0];
        d[1] = s[1];
        d[2] = s[2];
    }
}
