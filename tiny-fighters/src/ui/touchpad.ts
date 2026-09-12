// src/ui/touchpad.ts — on-screen gamepad for touch devices (P1 only).
// D-pad (left cluster) + attack/jump/defend (right cluster) drive a touch
// source; a pause button covers the no-Escape-key gap. Mounted by the battle
// scene only when hasTouch() is true. Returns a destroyer for teardown.
import { el } from "./kit";
import type { TouchAction, TouchSource } from "../input/touch";

const BUTTONS: ReadonlyArray<readonly [string, TouchAction, string]> = [
  ["◀", "left", "d-left"],
  ["▶", "right", "d-right"],
  ["▲", "up", "d-up"],
  ["▼", "down", "d-down"],
  ["A", "attack", "a"],
  ["J", "jump", "j"],
  ["D", "defend", "d"],
];

export function mountTouchPad(
  host: HTMLElement,
  source: TouchSource,
  onPause: () => void,
): () => void {
  const pad = el("div", { cls: "touchpad" });
  const stick = el("div", { cls: "tcluster dstick" });
  const actions = el("div", { cls: "tcluster abtns" });
  for (const [label, action, cls] of BUTTONS) {
    const btn = el("div", { cls: `tbtn ${cls}`, text: label });
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      source.press(action);
    });
    const release = (): void => source.release(action);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
    (action === "attack" || action === "jump" || action === "defend" ? actions : stick).appendChild(btn);
  }
  pad.appendChild(stick);
  pad.appendChild(actions);
  const pause = el("div", { cls: "tbtn pausebtn", text: "II", onClick: onPause });
  host.appendChild(pad);
  host.appendChild(pause);
  return () => {
    pad.remove();
    pause.remove();
    source.clear();
  };
}
