// tests/input/pad-join.test.ts — rising-edge detection for "press Attack to
// join" on the select screen: one report per press, independent pads, and
// missing snapshots treated as not pressed.
import { describe, test, expect } from "bun:test";
import { createPadJoinWatcher } from "../../src/input/pad-join";
import type { SnapshotProvider } from "../../src/input/gamepad";

function attackProvider(state: { a: boolean }): SnapshotProvider {
  return () => ({ buttons: [{}, {}, { pressed: state.a }] });
}

describe("pad join watcher", () => {
  test("reports the rising edge once, then again after release+press", () => {
    const state = { a: false };
    const w = createPadJoinWatcher([attackProvider(state)]);
    expect(w.poll()).toEqual([]);          // up
    state.a = true;  expect(w.poll()).toEqual([0]);
    expect(w.poll()).toEqual([]);          // still held
    state.a = false; expect(w.poll()).toEqual([]);
    state.a = true;  expect(w.poll()).toEqual([0]);
  });

  test("tracks pads independently", () => {
    const a = { a: false }, b = { a: true };
    const w = createPadJoinWatcher([attackProvider(a), attackProvider(b)]);
    expect(w.poll()).toEqual([1]);
    a.a = true;
    expect(w.poll()).toEqual([0]);
  });

  test("missing snapshot counts as not pressed", () => {
    let snap: ReturnType<SnapshotProvider> = null;
    const w = createPadJoinWatcher([() => snap]);
    expect(w.poll()).toEqual([]);
    snap = { buttons: [{}, {}, { pressed: true }] };
    expect(w.poll()).toEqual([0]);
  });
});
