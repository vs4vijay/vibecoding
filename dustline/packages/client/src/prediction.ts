import { CORRECTION_LERP_MS } from '@dustline/shared';

/**
 * Maximum number of unacked inputs retained for replay — 2 seconds of inputs
 * at the 60 Hz tick rate. Bounds memory and acts as a safety valve: if inputs
 * go permanently unacked (e.g. a teleport/respawn the client never predicted),
 * the oldest inputs are discarded and the client converges to the server.
 */
export const MAX_PENDING_INPUTS = 120;

export interface Predictor<TState, TInput, TServer = TState> {
  /**
   * Queue a local input for replay and apply it to the predicted state
   * immediately, so movement shows up on the next rendered frame.
   */
  pushLocalInput(seq: number, input: TInput): void;
  /**
   * Feed an authoritative state plus the highest input seq the server has
   * processed (ackedSeq). Stale snapshots (older ackedSeq) are ignored;
   * otherwise the authoritative state replaces the prediction baseline and
   * all queued inputs with seq > ackedSeq are re-applied in order.
   */
  onServerSnapshot(authoritative: TServer, ackedSeq: number): void;
  /**
   * The state to render: the predicted state, with any server correction
   * eased in over CORRECTION_LERP_MS so the camera never snaps. Returns null
   * until the first server snapshot has been processed.
   */
  getRenderState(): TState | null;
  /** Number of inputs currently queued for replay. */
  pendingCount(): number;
}

/**
 * Client-side predictor with server reconciliation. Pure and DOM-free: time
 * is read through the injectable `now` clock (defaults to Date.now) and all
 * state transitions go through the supplied apply functions, so it can be
 * exercised headlessly.
 *
 * @param applyInput       applies one input to a state, returning the next state
 * @param applyServerState converts an authoritative server state into the
 *                         predicted-state shape
 * @param now              monotonic-ish clock in milliseconds (injectable for tests)
 */
export function createPredictor<TState, TInput, TServer = TState>(
  applyInput: (state: TState, input: TInput) => TState,
  applyServerState: (authoritative: TServer) => TState,
  now: () => number = Date.now,
): Predictor<TState, TInput, TServer> {
  interface Pending {
    seq: number;
    input: TInput;
  }

  const pending: Pending[] = [];
  let simState: TState | null = null;
  let lastAckedSeq = 0;
  let correctionFrom: TState | null = null;
  let correctionStart = 0;

  function getRenderState(): TState | null {
    if (simState === null) return null;
    if (correctionFrom === null) return cloneState(simState);

    const t = (now() - correctionStart) / CORRECTION_LERP_MS;
    if (t >= 1) {
      correctionFrom = null; // correction fully absorbed
      return cloneState(simState);
    }
    return lerpState(correctionFrom, simState, Math.max(t, 0));
  }

  return {
    pushLocalInput(seq, input) {
      pending.push({ seq, input });
      pending.sort((a, b) => a.seq - b.seq);
      if (pending.length > MAX_PENDING_INPUTS) {
        pending.splice(0, pending.length - MAX_PENDING_INPUTS);
      }
      if (simState !== null) {
        simState = applyInput(simState, input);
      }
    },

    onServerSnapshot(authoritative, ackedSeq) {
      // Stale or reordered delivery: never regress to an older ack/state.
      if (ackedSeq < lastAckedSeq) return;
      lastAckedSeq = ackedSeq;

      const base = applyServerState(authoritative);

      // Trim acked inputs, then re-apply the remainder in order.
      let firstUnacked = 0;
      while (firstUnacked < pending.length && pending[firstUnacked].seq <= ackedSeq) {
        firstUnacked++;
      }
      const unacked = pending.slice(firstUnacked);
      pending.length = 0;
      pending.push(...unacked);

      let reconciled = base;
      for (const entry of unacked) {
        reconciled = applyInput(reconciled, entry.input);
      }

      // If reconciliation moved the predicted state, ease the visual error
      // out instead of snapping: start from wherever we are rendering now.
      if (simState !== null && !statesEqual(simState, reconciled)) {
        correctionFrom = getRenderState() ?? cloneState(reconciled);
        correctionStart = now();
      }
      simState = reconciled;
    },

    getRenderState,
    pendingCount: () => pending.length,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneState<T>(state: T): T {
  if (!isPlainObject(state)) {
    if (Array.isArray(state)) return state.map(item => cloneState(item)) as unknown as T;
    return state;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    out[key] = cloneState(value);
  }
  return out as T;
}

function statesEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((item, i) => statesEqual(item, b[i]));
    }
    return a === b;
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(key => key in b && statesEqual(a[key], b[key]));
}

/**
 * Deep numeric interpolation between two states of the same shape: numbers
 * (recursively, including inside objects/arrays) are lerped; any other value
 * (booleans, strings, null) snaps to the target immediately.
 */
function lerpState<T>(from: T, to: T, t: number): T {
  if (typeof from === 'number' && typeof to === 'number') {
    return (from + (to - from) * t) as unknown as T;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    return from.map((item, i) => lerpState(item, to[i], t)) as unknown as T;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    const out: Record<string, unknown> = {};
    for (const [key, toValue] of Object.entries(to)) {
      out[key] = key in from ? lerpState(from[key], toValue, t) : toValue;
    }
    return out as T;
  }
  return cloneState(to);
}
