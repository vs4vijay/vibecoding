/**
 * Interactive tutorial — 6 gated steps [spec §8]:
 *   1. Move to marked point
 *   2. Land 3 punches
 *   3. Reverse 1 attack (scripted attacker telegraphing punches slowly)
 *   4. Leg-cannon a dummy
 *   5. Pick up knife + throw it
 *   6. Stealth-kill a sleeper
 *
 * Pure event-driven logic. The class owns a bottom-center hint DOM element.
 * Game.ts pushes per-step events and reads `{ done, hint }`.
 *
 * No three/Rapier. No sim imports.
 */

import type { TutorialStep } from '../types';
import { injectUIStyles, el } from './dom';

/** Events the game layer pushes per sim step. */
export interface TutorialEvent {
  type: 'punch' | 'reversal' | 'legCannon' | 'knifePicked' | 'knifeThrown' | 'stealthKill';
}

/** What the tutorial needs the game layer to provide for a given step. */
export interface StepRequirements {
  /** If true, the game layer should spawn a dummy wolf. */
  needsDummy: boolean;
  /** If true, spawn a scripted punching attacker. */
  needsAttacker: boolean;
  /** If true, spawn a sleeper wolf. */
  needsSleeper: boolean;
  /** If true, spawn a knife pickup on the ground. */
  needsKnife: boolean;
}

const STEPS: readonly TutorialStep[] = [
  { id: 'movement', hint: 'Move to the marker (WASD to walk)' },
  { id: 'punch', hint: 'Land 3 punches on the dummy (LMB to punch)' },
  { id: 'reversal', hint: "Reverse the attacker's punch (tap Shift as it swings)" },
  { id: 'legCannon', hint: 'Leg cannon the dummy (run + Space to jump-kick)' },
  { id: 'knife', hint: 'Crouch by the knife to pick it up, then tap Shift again to throw' },
  { id: 'stealth', hint: 'Sneak behind the sleeper and attack (crouch-walk, then LMB)' },
];

const STEP_REQUIREMENTS: readonly StepRequirements[] = [
  { needsDummy: false, needsAttacker: false, needsSleeper: false, needsKnife: false },  // movement
  { needsDummy: true,  needsAttacker: false, needsSleeper: false, needsKnife: false },  // punch
  { needsDummy: false, needsAttacker: true,  needsSleeper: false, needsKnife: false },  // reversal
  { needsDummy: true,  needsAttacker: false, needsSleeper: false, needsKnife: false },  // legCannon
  { needsDummy: false, needsAttacker: false, needsSleeper: false, needsKnife: true  },  // knife
  { needsDummy: false, needsAttacker: false, needsSleeper: true,  needsKnife: false },  // stealth
];

/** Marker position for the movement step (world XZ, Y derived by game.ts). */
const MOVEMENT_MARKER = { x: 5, z: 0 };
const REACH_THRESHOLD_M = 1.2;
const PUNCH_GOAL = 3;
const SKIP_KEY = 'Escape';

export class Tutorial {
  private stepIndex = 0;
  private punchCount = 0;
  private hintEl: HTMLDivElement | null = null;
  private skipHandler: ((e: KeyboardEvent) => void) | null = null;
  private _done = false;

  constructor() {
    injectUIStyles();
    this.hintEl = el('div', 'lg-hint lg-backdrop', STEPS[0].hint);
    this.hintEl.style.pointerEvents = 'none';
    document.getElementById('ui-root')?.appendChild(this.hintEl);

    // ESC skips all
    this.skipHandler = (e: KeyboardEvent) => {
      if (e.code === SKIP_KEY) this._done = true;
    };
    window.addEventListener('keydown', this.skipHandler);
  }

  get done(): boolean { return this._done; }
  get currentStepIndex(): number { return this.stepIndex; }
  get currentStepId(): string { return STEPS[this.stepIndex]?.id ?? ''; }
  get marker(): { x: number; z: number } | null {
    return this.currentStepId === 'movement' ? MOVEMENT_MARKER : null;
  }
  get requirements(): StepRequirements {
    return STEP_REQUIREMENTS[this.stepIndex] ?? STEP_REQUIREMENTS[0];
  }

  /**
   * Advance one sim step. Returns `{ done, hint }` — `done` is true when
   * all steps are completed or the player pressed ESC to skip.
   */
  update(
    events: readonly TutorialEvent[],
    playerPos: { x: number; z: number },
    playerWeapon: string | null,
  ): { done: boolean; hint: string } {
    if (this._done) return { done: true, hint: '' };

    const id = this.currentStepId;
    let stepComplete = false;

    switch (id) {
      case 'movement': {
        const dx = playerPos.x - MOVEMENT_MARKER.x;
        const dz = playerPos.z - MOVEMENT_MARKER.z;
        stepComplete = Math.hypot(dx, dz) < REACH_THRESHOLD_M;
        break;
      }
      case 'punch':
        for (const ev of events) {
          if (ev.type === 'punch') this.punchCount++;
        }
        stepComplete = this.punchCount >= PUNCH_GOAL;
        break;
      case 'reversal':
        stepComplete = events.some((ev) => ev.type === 'reversal');
        break;
      case 'legCannon':
        stepComplete = events.some((ev) => ev.type === 'legCannon');
        break;
      case 'knife':
        // Complete after the knife is thrown (which implies it was picked up)
        stepComplete = events.some((ev) => ev.type === 'knifeThrown');
        break;
      case 'stealth':
        stepComplete = events.some((ev) => ev.type === 'stealthKill');
        break;
    }

    if (stepComplete) {
      this.stepIndex++;
      this.punchCount = 0;
      if (this.stepIndex >= STEPS.length) {
        this._done = true;
        this.hide();
        return { done: true, hint: '' };
      }
      // Show new hint
      if (this.hintEl) this.hintEl.textContent = STEPS[this.stepIndex].hint;
    }

    return { done: false, hint: STEPS[this.stepIndex]?.hint ?? '' };
  }

  hide(): void {
    if (this.hintEl) this.hintEl.classList.add('hidden');
  }

  show(): void {
    this.stepIndex = 0;
    this.punchCount = 0;
    this._done = false;
    if (this.hintEl) {
      this.hintEl.textContent = STEPS[0].hint;
      this.hintEl.classList.remove('hidden');
    }
  }

  /** Skip all remaining tutorial steps (ESC binding). */
  skipAll(): void {
    this._done = true;
    this.hide();
  }

  dispose(): void {
    if (this.skipHandler) {
      window.removeEventListener('keydown', this.skipHandler);
      this.skipHandler = null;
    }
    this.hintEl?.remove();
  }
}