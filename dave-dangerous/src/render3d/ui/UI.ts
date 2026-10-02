// src/render3d/ui/UI.ts — AAA DOM overlay ("CATACOMB DEPTHS" overhaul).
// Self-contained presentation layer: builds its own DOM and scoped stylesheet
// inside the container game.ts passes in (index.html only supplies the page
// shell, Google Fonts and the canvas mount). Screens: title menu (with
// settings / how-to-play / new-game confirm), playing HUD, pause, game over,
// level clear, toasts.
//
// setState() receives the full RenderUiState every frame and is diff-driven —
// DOM is touched only when a value actually changes, so there is no layout
// thrash at 60 fps. All motion is CSS-eased (cubic-bezier); nothing snaps.
// Reads RenderUiState via setState(); never imports the sim.
import type { RenderUiState } from "../viewTypes";

export interface UiCallbacks {
  onStart(): void;      // title screen → play
  onStartConfirmed(): void; // new-game confirm accepted → fresh game
  onResume(): void;     // pause → resume
  onRestart(): void;    // game over / pause → restart
  onNext(): void;       // level clear → continue
  onToggleMute(): void; // returns via callback chain; UI reflects muted via setMuted
  onGesture(): void;    // any pointer/key gesture (audio unlock)
}

type Flow = RenderUiState["flow"];

interface MenuItem {
  el: HTMLButtonElement;
  action(): void;
}
interface ToastEntry {
  el: HTMLDivElement;
  hideTimer: number;
  dead: boolean;
}

// --- formatting helpers -------------------------------------------------------
function padScore(n: number): string {
  return String(Math.max(0, n)).padStart(6, "0");
}
function padLevel(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}
function fuelFrac(fuel: number, fuelMax: number): number {
  if (fuelMax <= 0) return 0;
  const n = fuel / fuelMax;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
/** New-game gate (design D3): a fresh start over a saved run asks first. */
export function shouldConfirmNewGame(hasSave: boolean): boolean {
  return hasSave;
}
/** Low-fuel toast edge (pure, DOM-free): fires only on the false→true rise. */
export function fuelWarningEdge(prev: boolean, curr: boolean): "warn" | null {
  return !prev && curr ? "warn" : null;
}

/** First-session controls-hint marker (BestScore-style try/catch persistence). */
const HINT_STORAGE_KEY = "dave-dangerous-hinted";

// --- stylesheet (scoped to .ddui-*, tokens mirror src/render3d/palette.ts) ----
const CSS = `
.ddui-root {
  --ddui-deep: #05080c;
  --ddui-fog: #0b141b;
  --ddui-slate: #16323d;
  --ddui-ember: #ffb347;
  --ddui-ember-hot: #ffd27a;
  --ddui-gold: #d9a441;
  --ddui-crimson: #c93b2e;
  --ddui-crimson-hi: #e05845;
  --ddui-moss: #7fb7a8;
  --ddui-text: #e8ecf2;
  --ddui-dim: #93a6b1;
  --ddui-panel-bg: rgba(10, 15, 20, 0.78);
  --ddui-hairline: rgba(217, 164, 65, 0.32);
  --ddui-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ddui-ease-soft: cubic-bezier(0.33, 0, 0.2, 1);
  --ddui-font-display: "Cinzel", Georgia, "Times New Roman", serif;
  --ddui-font-ui: "Outfit", "Sora", system-ui, sans-serif;

  position: absolute;
  inset: 0;
  z-index: 20;
  overflow: hidden;
  pointer-events: none;
  font-family: var(--ddui-font-ui);
  color: var(--ddui-text);
  user-select: none;
  -webkit-user-select: none;
}
.ddui-root * { box-sizing: border-box; margin: 0; padding: 0; }
.ddui-root button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.ddui-root :focus { outline: none; }
.ddui-root :focus-visible { outline: 1px solid rgba(255, 179, 71, 0.85); outline-offset: 3px; border-radius: 2px; }

/* --- screens (eased enter/exit, no pointer events while hidden) ------------- */
.ddui-screen {
  position: absolute;
  inset: 0;
  display: flex;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.5s var(--ddui-ease), visibility 0s linear 0.5s;
}
.ddui-screen.is-on { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s, 0s; }
.ddui-passive, .ddui-passive.is-on { pointer-events: none; }

/* staggered rise-in for marked children */
.ddui-rise { opacity: 0; transform: translateY(18px); transition: opacity 0.7s var(--ddui-ease), transform 0.7s var(--ddui-ease); }
.ddui-rise--down { transform: translateY(-18px); }
.ddui-screen.is-on .ddui-rise { opacity: 1; transform: translateY(0); transition-delay: var(--d, 0ms); }

/* --- shared glass panel (near-black, gold hairline, corner ticks) ----------- */
.ddui-panel {
  position: relative;
  background: var(--ddui-panel-bg);
  border: 1px solid var(--ddui-hairline);
  border-radius: 8px;
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  box-shadow: 0 12px 40px rgba(5, 8, 12, 0.45);
}
.ddui-panel::before, .ddui-panel::after { content: ""; position: absolute; width: 9px; height: 9px; pointer-events: none; }
.ddui-panel::before { top: -1px; left: -1px; border-top: 1px solid rgba(255, 179, 71, 0.75); border-left: 1px solid rgba(255, 179, 71, 0.75); border-top-left-radius: 8px; }
.ddui-panel::after { bottom: -1px; right: -1px; border-bottom: 1px solid rgba(255, 179, 71, 0.75); border-right: 1px solid rgba(255, 179, 71, 0.75); border-bottom-right-radius: 8px; }
.ddui-panel.is-pop, .ddui-best-badge.is-pop { animation: ddui-pop 0.38s var(--ddui-ease); }
@keyframes ddui-pop { 0% { transform: scale(1); } 35% { transform: scale(1.05); } 100% { transform: scale(1); } }

.ddui-hud-label { font-size: 10px; font-weight: 600; letter-spacing: 0.32em; color: var(--ddui-dim); white-space: nowrap; }
.ddui-kbd {
  display: inline-block;
  min-width: 20px;
  padding: 3px 7px 4px;
  border: 1px solid rgba(232, 236, 242, 0.22);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  font-family: var(--ddui-font-ui);
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.08em;
  color: #cfd9e0;
  text-align: center;
}

/* --- title menu -------------------------------------------------------------- */
.ddui-menu { flex-direction: column; align-items: center; }
.ddui-menu-bg { position: absolute; inset: 0; z-index: 0; }
.ddui-menu-bg::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 90% at 50% 8%, rgba(5, 8, 12, 0) 0%, rgba(5, 8, 12, 0.34) 55%, rgba(5, 8, 12, 0.82) 100%),
    linear-gradient(180deg, rgba(5, 8, 12, 0.5) 0%, rgba(5, 8, 12, 0.12) 34%, rgba(5, 8, 12, 0.62) 100%);
}
.ddui-menu-bg::after {
  content: "";
  position: absolute;
  inset: -18%;
  background: radial-gradient(42% 30% at 50% 24%, rgba(255, 179, 71, 0.1), transparent 70%);
  animation: ddui-haze 7s ease-in-out infinite alternate;
}
@keyframes ddui-haze { from { opacity: 0.55; transform: translateY(-10px) scale(1); } to { opacity: 1; transform: translateY(12px) scale(1.06); } }

.ddui-title { position: relative; z-index: 1; text-align: center; margin-top: 10vh; pointer-events: none; }
.ddui-overline { font-size: 12px; font-weight: 600; letter-spacing: 0.6em; text-indent: 0.6em; color: var(--ddui-gold); margin-bottom: 10px; }
.ddui-logo {
  font-family: var(--ddui-font-display);
  font-size: clamp(68px, 16vh, 148px);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-indent: 0.1em;
  line-height: 1;
  color: #f4ead6;
  animation: ddui-logo-glow 5.5s ease-in-out infinite alternate;
}
@keyframes ddui-logo-glow {
  from { text-shadow: 0 0 22px rgba(255, 179, 71, 0.22), 0 0 80px rgba(255, 90, 31, 0.12); }
  to { text-shadow: 0 0 32px rgba(255, 179, 71, 0.42), 0 0 110px rgba(255, 90, 31, 0.22); }
}
.ddui-sub { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 14px; font-size: 12px; font-weight: 500; letter-spacing: 0.5em; text-indent: 0.5em; color: var(--ddui-dim); }
.ddui-rule { width: 64px; height: 1px; background: linear-gradient(90deg, transparent, rgba(217, 164, 65, 0.7)); }
.ddui-rule--flip { transform: scaleX(-1); }

.ddui-nav { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; min-width: 340px; margin-top: 6vh; }
.ddui-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 12px 26px 14px 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
  pointer-events: auto;
  transition: background 0.3s var(--ddui-ease), border-color 0.3s var(--ddui-ease);
}
.ddui-item.is-hidden { display: none; }
.ddui-item-main { display: flex; flex-direction: column; }
.ddui-item-label { font-size: 14px; font-weight: 500; letter-spacing: 0.26em; color: #aebbc4; white-space: nowrap; transition: color 0.3s var(--ddui-ease), text-shadow 0.3s var(--ddui-ease); }
.ddui-item-sub { font-size: 10px; letter-spacing: 0.3em; color: var(--ddui-dim); margin: 5px 0 6px; transition: color 0.3s var(--ddui-ease); }
.ddui-item-value { font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: var(--ddui-gold); transition: transform 0.35s var(--ddui-ease); white-space: nowrap; }
.ddui-item::before {
  content: "";
  position: absolute;
  left: 12px;
  top: 50%;
  width: 7px;
  height: 7px;
  margin-top: -4px;
  border-top: 1px solid var(--ddui-ember);
  border-right: 1px solid var(--ddui-ember);
  transform: translateY(-50%) rotate(45deg) translateX(-5px);
  opacity: 0;
  transition: opacity 0.35s var(--ddui-ease), transform 0.35s var(--ddui-ease);
}
.ddui-item::after {
  content: "";
  position: absolute;
  left: 26px;
  right: 26px;
  bottom: 5px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ddui-ember) 30%, var(--ddui-ember) 70%, transparent);
  transform: scaleX(0);
  transition: transform 0.4s var(--ddui-ease);
}
.ddui-item.is-selected { background: rgba(10, 15, 20, 0.62); border-color: rgba(217, 164, 65, 0.28); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.ddui-item.is-selected .ddui-item-label { color: var(--ddui-ember-hot); text-shadow: 0 0 16px rgba(255, 179, 71, 0.35); }
.ddui-item.is-selected .ddui-item-sub { color: rgba(255, 210, 122, 0.75); }
.ddui-item.is-selected::before { opacity: 1; transform: translateY(-50%) rotate(45deg) translateX(0); }
.ddui-item.is-selected::after { transform: scaleX(1); }
.ddui-item.is-open .ddui-item-value { transform: rotate(90deg); }

/* how-to-play side panel */
.ddui-howto {
  position: absolute;
  right: 6vw;
  top: 50%;
  z-index: 5;
  width: 322px;
  padding: 24px 26px 20px;
  transform: translateY(-50%) translateX(24px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.45s var(--ddui-ease), transform 0.45s var(--ddui-ease), visibility 0s linear 0.45s;
}
.ddui-howto.is-open { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(-50%) translateX(0); transition-delay: 0s; }
.ddui-howto h3 { font-family: var(--ddui-font-display); font-size: 15px; font-weight: 700; letter-spacing: 0.3em; text-indent: 0.3em; text-align: center; color: var(--ddui-ember-hot); margin-bottom: 16px; }
.ddui-howto-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px solid rgba(217, 164, 65, 0.1); font-size: 11px; font-weight: 500; letter-spacing: 0.22em; color: #b6c2ca; }
.ddui-howto-row:last-child { border-bottom: 0; }
.ddui-howto-keys { display: flex; gap: 4px; }

/* new-game confirm — modal overlay scoped to the menu screen (not a flow) */
.ddui-confirm {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.5s var(--ddui-ease), visibility 0s linear 0.5s;
}
.ddui-confirm.is-open { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s, 0s; }
.ddui-confirm .ddui-card { min-width: min(380px, 86vw); padding: 32px 40px; }
.ddui-confirm.is-open .ddui-card { opacity: 1; transform: translateY(0) scale(1); transition-delay: 0.08s; }
.ddui-confirm .ddui-card-title { font-size: clamp(24px, 4vw, 32px); }
.ddui-confirm-note { margin-top: 12px; font-size: 11px; font-weight: 500; letter-spacing: 0.18em; color: var(--ddui-dim); }

.ddui-menu-foot { position: absolute; left: 0; right: 0; bottom: 28px; z-index: 1; display: flex; justify-content: center; gap: 28px; font-size: 10px; font-weight: 500; letter-spacing: 0.28em; color: var(--ddui-dim); }
.ddui-menu-foot span { display: flex; align-items: center; gap: 8px; }
.ddui-menu-best { color: var(--ddui-gold); font-variant-numeric: tabular-nums; }
.ddui-menu-best.is-hidden { display: none; }

/* --- HUD ---------------------------------------------------------------------- */
.ddui-hud { display: block; padding: 24px 28px; }
.ddui-hud-top { display: flex; justify-content: space-between; align-items: flex-start; }
.ddui-hud-side { display: flex; gap: 12px; align-items: stretch; }
.ddui-hud-bottom { position: absolute; left: 28px; right: 28px; bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
.ddui-score-panel { padding: 10px 18px 12px; min-width: 156px; }
.ddui-score { font-size: 22px; font-weight: 600; letter-spacing: 0.12em; line-height: 1.25; color: #f2ecdc; font-variant-numeric: tabular-nums; }
.ddui-depth-chip { padding: 10px 16px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 88px; }
.ddui-depth { font-family: var(--ddui-font-display); font-size: 20px; font-weight: 700; line-height: 1.15; color: var(--ddui-ember-hot); }
.ddui-lives-panel { padding: 10px 16px 12px; display: flex; flex-direction: column; gap: 8px; }
.ddui-pips { display: flex; gap: 9px; padding: 0 2px; }
.ddui-pip { width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid rgba(217, 164, 65, 0.45); transition: background 0.35s var(--ddui-ease), border-color 0.35s var(--ddui-ease), box-shadow 0.35s var(--ddui-ease); }
.ddui-pip.is-filled { background: linear-gradient(135deg, #c93b2e, #e8683f); border-color: rgba(255, 210, 122, 0.9); box-shadow: 0 0 9px rgba(201, 59, 46, 0.55); }
/* real <button>: the one clickable child of the .ddui-passive HUD screen; also
   re-asserts the panel visuals the .ddui-root button reset would strip */
.ddui-root button.ddui-sound-pill {
  pointer-events: auto;
  padding: 10px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  background: var(--ddui-panel-bg);
  border: 1px solid var(--ddui-hairline);
}
.ddui-eq { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 13px; }
.ddui-eq i { width: 3px; height: 100%; border-radius: 1px; background: var(--ddui-ember-hot); transform-origin: bottom; animation: ddui-eq 1s ease-in-out infinite; }
.ddui-eq i:nth-child(2) { animation-delay: 0.18s; }
.ddui-eq i:nth-child(3) { animation-delay: 0.36s; }
@keyframes ddui-eq { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.ddui-sound-pill.is-muted .ddui-eq i { animation-play-state: paused; transform: scaleY(0.14); opacity: 0.35; }
.ddui-sound-pill.is-muted .ddui-eq::after { content: ""; position: absolute; left: -4px; right: -4px; top: 50%; height: 1px; background: var(--ddui-crimson-hi); transform: rotate(-22deg); }
.ddui-jet { padding: 12px 16px; width: min(300px, 42vw); }
.ddui-jet-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 9px; }
.ddui-fuel-pct { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; color: var(--ddui-ember-hot); font-variant-numeric: tabular-nums; }
.ddui-fuel { position: relative; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(217, 164, 65, 0.25); overflow: hidden; }
.ddui-fuel-fill { position: absolute; inset: 1px; border-radius: 3px; background: linear-gradient(90deg, #d9a441, #ffd27a); transform-origin: left center; transform: scaleX(0); transition: transform 0.2s var(--ddui-ease-soft); }
.ddui-fuel-segs { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0, transparent 46px, rgba(5, 8, 12, 0.85) 46px, rgba(5, 8, 12, 0.85) 48px); pointer-events: none; }
.ddui-jet.is-low .ddui-fuel-fill { background: linear-gradient(90deg, #a03024, var(--ddui-crimson-hi)); animation: ddui-low 0.85s ease-in-out infinite; }
.ddui-jet.is-low .ddui-hud-label, .ddui-jet.is-low .ddui-fuel-pct { color: var(--ddui-crimson-hi); }
@keyframes ddui-low { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.65); } }
.ddui-gun { padding: 10px 16px 12px; display: flex; align-items: center; gap: 10px; }
.ddui-gun-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(217, 164, 65, 0.5); transition: background 0.35s var(--ddui-ease), border-color 0.35s var(--ddui-ease), box-shadow 0.35s var(--ddui-ease); }
.ddui-gun .ddui-hud-label { transition: color 0.35s var(--ddui-ease); }
.ddui-gun.is-armed .ddui-gun-dot { background: var(--ddui-ember); border-color: var(--ddui-ember-hot); box-shadow: 0 0 10px rgba(255, 179, 71, 0.75); }
.ddui-gun.is-armed .ddui-hud-label { color: var(--ddui-ember-hot); }
.ddui-play-hint { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border: 1px solid rgba(217, 164, 65, 0.16); border-radius: 6px; background: rgba(10, 15, 20, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 10px; font-weight: 500; letter-spacing: 0.26em; color: var(--ddui-dim); }

/* --- top-center notes (HUD, passive): level banner above, first-session
   controls hint below; both slots always reserved so they never collide ----- */
.ddui-topnote {
  position: absolute;
  top: 110px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.ddui-topnote > * {
  visibility: hidden;
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 0.45s var(--ddui-ease), transform 0.45s var(--ddui-ease), visibility 0s linear 0.45s;
}
.ddui-topnote > .is-on { visibility: visible; opacity: 1; transform: translateY(0); transition-delay: 0s, 0s, 0s; }
.ddui-level-banner {
  padding: 10px 22px 11px;
  border: 1px solid var(--ddui-hairline);
  border-radius: 6px;
  background: var(--ddui-panel-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(5, 8, 12, 0.4);
  font-family: var(--ddui-font-display);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: var(--ddui-ember-hot);
  white-space: nowrap;
}
.ddui-controls-hint {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 16px 10px;
  border: 1px solid rgba(217, 164, 65, 0.16);
  border-radius: 6px;
  background: rgba(10, 15, 20, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ddui-controls-hint > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.24em;
  color: var(--ddui-dim);
  white-space: nowrap;
}

/* --- modal cards (pause / game over / clear) ---------------------------------- */
.ddui-modal { align-items: center; justify-content: center; }
.ddui-backdrop { position: absolute; inset: 0; background: radial-gradient(100% 100% at 50% 42%, rgba(5, 8, 12, 0.42) 0%, rgba(5, 8, 12, 0.8) 100%); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.ddui-modal--over .ddui-backdrop { box-shadow: inset 0 0 200px rgba(201, 59, 46, 0.28); }
.ddui-modal--clear .ddui-backdrop { box-shadow: inset 0 0 200px rgba(255, 179, 71, 0.14); }
.ddui-card { position: relative; min-width: min(432px, 86vw); padding: 40px 52px 36px; text-align: center; opacity: 0; transform: translateY(20px) scale(0.98); transition: opacity 0.6s var(--ddui-ease), transform 0.6s var(--ddui-ease); }
.ddui-modal.is-on .ddui-card { opacity: 1; transform: translateY(0) scale(1); transition-delay: 0.08s; }
.ddui-card-title { font-family: var(--ddui-font-display); font-size: clamp(30px, 5vw, 44px); font-weight: 700; letter-spacing: 0.14em; text-indent: 0.14em; line-height: 1.15; margin-top: 8px; color: #f2ecdc; }
.ddui-modal--over .ddui-card-title { color: var(--ddui-crimson-hi); animation: ddui-over-pulse 2.6s ease-in-out infinite; }
@keyframes ddui-over-pulse { 0%, 100% { text-shadow: 0 0 24px rgba(201, 59, 46, 0.35); } 50% { text-shadow: 0 0 46px rgba(201, 59, 46, 0.6); } }
.ddui-modal--clear .ddui-card-title { background: linear-gradient(100deg, #c9963a 15%, #ffe6ae 45%, #d9a441 70%); background-size: 230% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: ddui-shimmer 2.8s linear infinite; }
@keyframes ddui-shimmer { 0% { background-position: 130% 0; } 100% { background-position: -130% 0; } }
.ddui-card-score-label { margin-top: 20px; font-size: 10px; font-weight: 600; letter-spacing: 0.34em; color: var(--ddui-dim); }
.ddui-card-score { margin-top: 6px; font-size: 34px; font-weight: 600; letter-spacing: 0.14em; color: var(--ddui-ember-hot); font-variant-numeric: tabular-nums; }
.ddui-card-best {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.26em;
  color: var(--ddui-dim);
  font-variant-numeric: tabular-nums;
}
.ddui-best-badge {
  display: none;
  padding: 3px 10px 4px;
  border: 1px solid rgba(255, 210, 122, 0.85);
  border-radius: 999px;
  background: rgba(255, 179, 71, 0.16);
  color: var(--ddui-ember-hot);
  font-size: 9px;
  letter-spacing: 0.28em;
  text-indent: 0.28em;
}
.ddui-best-badge.is-on { display: inline-block; }
.ddui-btnrow { display: flex; justify-content: center; gap: 14px; margin-top: 28px; }
.ddui-btn {
  pointer-events: auto;
  padding: 11px 26px;
  border: 1px solid rgba(217, 164, 65, 0.45);
  border-radius: 6px;
  background: rgba(255, 179, 71, 0.06);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  color: var(--ddui-ember-hot);
  transition: background 0.3s var(--ddui-ease), border-color 0.3s var(--ddui-ease), box-shadow 0.3s var(--ddui-ease), transform 0.3s var(--ddui-ease);
}
.ddui-btn:hover { background: rgba(255, 179, 71, 0.16); border-color: rgba(255, 179, 71, 0.85); box-shadow: 0 0 24px rgba(255, 179, 71, 0.18); transform: translateY(-1px); }
.ddui-btn:active { transform: translateY(0); }
.ddui-btn--primary { background: linear-gradient(180deg, #ffd27a, #d9a441); border-color: #ffd27a; color: #241703; }
.ddui-btn--primary:hover { background: linear-gradient(180deg, #ffe0a1, #e6b053); box-shadow: 0 0 28px rgba(255, 179, 71, 0.4); }
.ddui-card-hints { display: flex; justify-content: center; gap: 20px; margin-top: 24px; font-size: 10px; font-weight: 500; letter-spacing: 0.26em; color: var(--ddui-dim); }
.ddui-card-hints span { display: flex; align-items: center; gap: 8px; }

/* --- toasts -------------------------------------------------------------------- */
.ddui-toasts { position: absolute; left: 50%; bottom: 96px; z-index: 30; display: flex; flex-direction: column; align-items: center; gap: 8px; transform: translateX(-50%); }
.ddui-toast {
  position: relative;
  padding: 10px 20px 10px 32px;
  border: 1px solid var(--ddui-hairline);
  border-radius: 999px;
  background: var(--ddui-panel-bg);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  box-shadow: 0 10px 30px rgba(5, 8, 12, 0.5);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #dfe7ec;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(14px) scale(0.97);
  transition: opacity 0.42s var(--ddui-ease), transform 0.42s var(--ddui-ease);
}
.ddui-toast::before { content: ""; position: absolute; left: 14px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--ddui-dim); }
.ddui-toast.is-in { opacity: 1; transform: translateY(0) scale(1); }
.ddui-toast.is-out { opacity: 0; transform: translateY(-10px) scale(0.97); }
.ddui-toast.is-item::before { background: var(--ddui-ember); box-shadow: 0 0 10px rgba(255, 179, 71, 0.8); }
.ddui-toast.is-info::before { background: var(--ddui-moss); box-shadow: 0 0 10px rgba(127, 183, 168, 0.7); }
.ddui-toast.is-warn::before { background: var(--ddui-crimson-hi); box-shadow: 0 0 10px rgba(224, 88, 69, 0.8); }

/* --- responsive / reduced motion ------------------------------------------------ */
@media (max-width: 900px) {
  .ddui-howto { left: 50%; right: auto; top: auto; bottom: 96px; width: min(340px, 88vw); transform: translate(-50%, 16px); }
  .ddui-howto.is-open { transform: translate(-50%, 0); }
  .ddui-nav { min-width: min(340px, 84vw); }
}
@media (max-width: 720px) {
  .ddui-play-hint { display: none; }
  .ddui-jet { width: 52vw; }
}
/* narrow viewports: the four top HUD chips (SCORE/DEPTH/LIVES/SOUND) must share
   one row — tighten the gutters and panel chrome so nothing clips off-screen */
@media (max-width: 520px) {
  .ddui-hud { padding: 24px 14px; }
  .ddui-hud-top { gap: 8px; }
  .ddui-hud-side { gap: 8px; }
  .ddui-hud-label { letter-spacing: 0.22em; }
  .ddui-score-panel { padding: 8px 12px 9px; min-width: 118px; }
  .ddui-score { font-size: 18px; }
  .ddui-depth-chip { padding: 8px 10px 9px; min-width: 68px; }
  .ddui-lives-panel { padding: 8px 10px 9px; }
  .ddui-pips { gap: 6px; padding: 0; }
  .ddui-root button.ddui-sound-pill { padding: 8px 10px 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .ddui-root *, .ddui-root *::before, .ddui-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
/* coarse pointers: the TouchControls pads occupy the bottom corners, so lift
   the HUD's bottom row clear of them; touch players get the on-screen pause
   chip instead of the keyboard pause hint */
@media (pointer: coarse) {
  .ddui-hud-bottom { bottom: calc(132px + env(safe-area-inset-bottom)); }
  .ddui-play-hint { display: none; }
  /* the touch pause chip hangs below the HUD chips (ends ~140px): drop the
     banner stack under it, and let the long DEPTH line wrap instead of clip.
     The stack needs an explicit width — as a left:50% absolute box its natural
     extent is only half the viewport, which would wrap the banner far too soon */
  .ddui-topnote { top: calc(148px + env(safe-area-inset-top)); width: min(92vw, 560px); }
  .ddui-level-banner {
    max-width: min(92vw, 560px);
    white-space: normal;
    text-align: center;
    line-height: 1.6;
  }
  .ddui-controls-hint { max-width: min(92vw, 560px); }
  .ddui-controls-hint > span { white-space: normal; text-align: center; line-height: 1.6; }
}
`;

export class UI {
  // overlay scaffold
  private rootEl: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  // screens
  private menuEl: HTMLDivElement;
  private hudEl: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private overEl: HTMLDivElement;
  private clearEl: HTMLDivElement;
  private toastsEl: HTMLDivElement;
  // hud refs
  private scoreEl: HTMLDivElement;
  private scorePanel: HTMLDivElement;
  private depthEl: HTMLSpanElement;
  private depthChip: HTMLDivElement;
  private pipsEl: HTMLDivElement;
  private fuelFill: HTMLDivElement;
  private fuelPct: HTMLSpanElement;
  private jetPanel: HTMLDivElement;
  private gunChip: HTMLDivElement;
  private soundPill: HTMLButtonElement;
  // top-center HUD notes (passive): level banner + first-session controls hint
  private bannerEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private bannerTimer = 0;
  private hintTimer = 0;
  private hintShown = false;
  // menu refs
  private continueBtn: HTMLButtonElement;
  private continueSub: HTMLSpanElement;
  private soundValue: HTMLSpanElement;
  private howtoEl: HTMLDivElement;
  private howtoItem: HTMLButtonElement;
  private pauseBackdrop: HTMLDivElement;
  // new-game confirm dialog (menu-scoped, not a flow): open state + focus restore
  private confirmEl: HTMLDivElement;
  private confirmPrimary: HTMLButtonElement;
  private confirmOpen = false;
  private confirmRestore: HTMLElement | null = null;
  // save presence mirrored from syncMenuProgress — gates the NEW GAME confirm
  private hasSave = false;
  // modal score readouts
  private overScore: HTMLDivElement;
  private clearScore: HTMLDivElement;
  // best-score surfaces (menu foot line + game-over best row/badge)
  private menuBest: HTMLSpanElement;
  private overBest: HTMLSpanElement;
  private overBestBadge: HTMLSpanElement;
  // dialog state — primary button per modal, open modal, focus restore target
  private pausePrimary: HTMLButtonElement;
  private overPrimary: HTMLButtonElement;
  private clearPrimary: HTMLButtonElement;
  private openModal: Flow | null = null;
  private modalRestore: HTMLElement | null = null;
  // JS mirror of the stylesheet's prefers-reduced-motion override (JS-driven
  // animation steps need it too — the CSS override alone doesn't stop them)
  private motionMq: MediaQueryList | null = null;
  private reducedMotion = false;
  // menu selection model
  private allItems: MenuItem[] = [];
  private menuItems: MenuItem[] = [];
  private sel = 0;
  private howtoOpen = false;
  private menuSig = "";
  private pipCount = -1;
  // diff cache — DOM is only touched when a value changes
  private cache = {
    flow: "menu" as Flow,
    score: -1,
    lives: -1,
    level: -1,
    hasGun: false,
    fuel: -1,
    fuelMax: -1,
    lowFuel: false,
    muted: false,
    best: -1,
    newBest: false,
  };
  private toasts: ToastEntry[] = [];
  private pendingTimers = new Set<number>();
  private booted = false;
  // end-of-run card score count-up (rAF handle, 0 = idle)
  private countRaf = 0;

  constructor(root: HTMLElement, private cb: UiCallbacks) {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = CSS;
    this.rootEl = document.createElement("div");
    this.rootEl.className = "ddui-root";
    this.rootEl.appendChild(this.styleEl);
    root.appendChild(this.rootEl);

    // --- title menu -----------------------------------------------------
    // screens mount into the overlay root (absolute, stacked below the toasts)
    this.menuEl = this.div("ddui-screen ddui-menu", this.rootEl);
    this.div("ddui-menu-bg", this.menuEl);
    const title = this.div("ddui-title ddui-rise", this.menuEl);
    title.style.setProperty("--d", "60ms");
    this.div("ddui-overline", title).textContent = "DANGEROUS";
    const logo = this.tag("h1", "ddui-logo", title);
    logo.textContent = "DAVE";
    const sub = this.div("ddui-sub", title);
    this.div("ddui-rule", sub);
    this.tag("span", "", sub).textContent = "CATACOMB DEPTHS";
    this.div("ddui-rule ddui-rule--flip", sub);

    const nav = this.div("ddui-nav ddui-rise", this.menuEl);
    nav.style.setProperty("--d", "150ms");

    // continue — only when a saved descent exists (inferred from state)
    const continueBtn = this.buildMenuItem(nav, "CONTINUE");
    continueBtn.btn.classList.add("is-hidden");
    this.continueSub = this.tag("span", "ddui-item-sub", continueBtn.main);
    this.continueBtn = continueBtn.btn;
    this.addItem(continueBtn.btn, () => this.cb.onStart());

    const startBtn = this.buildMenuItem(nav, "NEW GAME");
    this.addItem(startBtn.btn, () => this.requestNewGame());

    const soundBtn = this.buildMenuItem(nav, "SOUND");
    this.soundValue = soundBtn.value;
    this.soundValue.textContent = "ON";
    this.addItem(soundBtn.btn, () => this.cb.onToggleMute());

    const howtoBtn = this.buildMenuItem(nav, "HOW TO PLAY");
    howtoBtn.value.textContent = "›";
    this.howtoItem = howtoBtn.btn;
    this.addItem(howtoBtn.btn, () => this.setHowto(!this.howtoOpen));

    this.howtoEl = this.buildHowto(this.menuEl);
    const confirm = this.buildConfirm(this.menuEl);
    this.confirmEl = confirm.overlay;
    this.confirmPrimary = confirm.primary;

    const foot = this.div("ddui-menu-foot ddui-rise", this.menuEl);
    foot.style.setProperty("--d", "260ms");
    foot.appendChild(this.hint("↑↓", "SELECT"));
    foot.appendChild(this.hint("ENTER", "CONFIRM"));
    foot.appendChild(this.hint("M", "SOUND"));
    this.menuBest = this.tag("span", "ddui-menu-best", foot);
    this.menuBest.textContent = `BEST ${padScore(0)}`;
    this.menuBest.classList.add("is-hidden"); // revealed by the best diff once best > 0

    // --- HUD --------------------------------------------------------------
    this.hudEl = this.div("ddui-screen ddui-hud ddui-passive", this.rootEl);
    this.hudEl.setAttribute("role", "region");
    this.hudEl.setAttribute("aria-label", "Game status");
    const hudTop = this.div("ddui-hud-top ddui-rise ddui-rise--down", this.hudEl);
    hudTop.style.setProperty("--d", "40ms");
    const hudLeft = this.div("ddui-hud-side", hudTop);
    this.scorePanel = this.div("ddui-panel ddui-score-panel", hudLeft);
    this.div("ddui-hud-label", this.scorePanel).textContent = "SCORE";
    this.scoreEl = this.div("ddui-score", this.scorePanel);
    this.scoreEl.textContent = padScore(0);
    this.depthChip = this.div("ddui-panel ddui-depth-chip", hudLeft);
    this.div("ddui-hud-label", this.depthChip).textContent = "DEPTH";
    this.depthEl = this.tag("span", "ddui-depth", this.depthChip);
    this.depthEl.textContent = padLevel(1);
    const hudRight = this.div("ddui-hud-side", hudTop);
    const livesPanel = this.div("ddui-panel ddui-lives-panel", hudRight);
    this.div("ddui-hud-label", livesPanel).textContent = "LIVES";
    this.pipsEl = this.div("ddui-pips", livesPanel);
    // real button (spans inside — a button may not contain divs); the only
    // interactive control on the otherwise passive HUD screen
    this.soundPill = this.tag("button", "ddui-panel ddui-sound-pill", hudRight);
    this.soundPill.type = "button";
    this.soundPill.setAttribute("aria-pressed", "false");
    this.soundPill.addEventListener("click", () => this.cb.onToggleMute());
    this.tag("span", "ddui-hud-label", this.soundPill).textContent = "SOUND";
    const eq = this.tag("span", "ddui-eq", this.soundPill);
    this.tag("i", "", eq);
    this.tag("i", "", eq);
    this.tag("i", "", eq);

    const hudBottom = this.div("ddui-hud-bottom ddui-rise", this.hudEl);
    hudBottom.style.setProperty("--d", "130ms");
    const hudBottomLeft = this.div("ddui-hud-side", hudBottom);
    this.jetPanel = this.div("ddui-panel ddui-jet", hudBottomLeft);
    const jetHead = this.div("ddui-jet-head", this.jetPanel);
    this.div("ddui-hud-label", jetHead).textContent = "JETPACK";
    this.fuelPct = this.tag("span", "ddui-fuel-pct", jetHead);
    this.fuelPct.textContent = "0%";
    const fuel = this.div("ddui-fuel", this.jetPanel);
    this.fuelFill = this.div("ddui-fuel-fill", fuel);
    this.div("ddui-fuel-segs", fuel);
    this.gunChip = this.div("ddui-panel ddui-gun", hudBottomLeft);
    this.tag("span", "ddui-gun-dot", this.gunChip);
    this.div("ddui-hud-label", this.gunChip).textContent = "PLASMA";
    const playHint = this.div("ddui-play-hint", hudBottom);
    playHint.appendChild(this.kbd("P"));
    this.tag("span", "", playHint).textContent = "PAUSE";

    // top-center note stack — banner and hint slots are always laid out, so the
    // two can never overlap when both are visible
    const topnote = this.div("ddui-topnote", this.hudEl);
    this.bannerEl = this.div("ddui-level-banner", topnote);
    this.hintEl = this.div("ddui-controls-hint", topnote);

    // --- pause --------------------------------------------------------------
    this.pauseEl = this.div("ddui-screen ddui-modal", this.rootEl);
    this.pauseBackdrop = this.div("ddui-backdrop", this.pauseEl);
    const pauseCard = this.buildCard(this.pauseEl, "ddui-pause-title", "DESCENT SUSPENDED", "PAUSED");
    const pauseRow = this.div("ddui-btnrow", pauseCard);
    this.pausePrimary = this.button("ddui-btn ddui-btn--primary", pauseRow, "RESUME", () => this.cb.onResume());
    this.button("ddui-btn", pauseRow, "RESTART", () => this.cb.onRestart());
    const pauseHints = this.div("ddui-card-hints", pauseCard);
    pauseHints.appendChild(this.hint("ESC", "RESUME"));
    pauseHints.appendChild(this.hint("M", "SOUND"));
    this.pauseEl.addEventListener("click", e => {
      if (e.target === this.pauseBackdrop) this.cb.onResume();
    });

    // --- game over ----------------------------------------------------------
    this.overEl = this.div("ddui-screen ddui-modal ddui-modal--over", this.rootEl);
    this.div("ddui-backdrop", this.overEl);
    const overCard = this.buildCard(this.overEl, "ddui-over-title", "THE CATACOMB CLAIMS YOU", "GAME OVER");
    this.div("ddui-card-score-label", overCard).textContent = "FINAL SCORE";
    this.overScore = this.div("ddui-card-score", overCard);
    this.overScore.textContent = padScore(0);
    const overBestRow = this.div("ddui-card-best", overCard);
    this.overBest = this.tag("span", "", overBestRow);
    this.overBest.textContent = `BEST ${padScore(0)}`;
    this.overBestBadge = this.tag("span", "ddui-best-badge", overBestRow);
    this.overBestBadge.textContent = "NEW BEST";
    const overRow = this.div("ddui-btnrow", overCard);
    this.overPrimary = this.button("ddui-btn ddui-btn--primary", overRow, "TRY AGAIN", () => this.cb.onRestart());
    const overHints = this.div("ddui-card-hints", overCard);
    overHints.appendChild(this.hint("R", "RETRY"));

    // --- level clear ----------------------------------------------------------
    this.clearEl = this.div("ddui-screen ddui-modal ddui-modal--clear", this.rootEl);
    this.div("ddui-backdrop", this.clearEl);
    const clearCard = this.buildCard(this.clearEl, "ddui-clear-title", "SECTION SECURED", "DEPTH CLEARED");
    this.div("ddui-card-score-label", clearCard).textContent = "SCORE";
    this.clearScore = this.div("ddui-card-score", clearCard);
    this.clearScore.textContent = padScore(0);
    const clearRow = this.div("ddui-btnrow", clearCard);
    this.clearPrimary = this.button("ddui-btn ddui-btn--primary", clearRow, "DESCEND", () => this.cb.onNext());
    const clearHints = this.div("ddui-card-hints", clearCard);
    clearHints.appendChild(this.hint("", "DESCENDING…"));

    // --- toasts ---------------------------------------------------------------
    this.toastsEl = this.div("ddui-toasts", this.rootEl);
    this.toastsEl.setAttribute("aria-live", "polite");

    // menu selection model (continue starts hidden)
    this.rebuildMenuItems();

    // global listeners — capture phase so the menu can own its keys; gesture
    // forwarding happens for every input (audio unlock).
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("pointerdown", this.onPointerDown, true);

    // JS reduced-motion guard, kept fresh for the JS-driven animations
    this.motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionMq.matches;
    this.motionMq.addEventListener("change", this.onMotionPreferenceChange);

    // boot paint: flow diffs fire on change only, and the first setState usually
    // matches cache.flow ("menu"), so the deferred first paint must be kicked here
    this.showFlow(this.cache.flow);
  }

  /** Diff-driven DOM update; call every frame. */
  setState(s: RenderUiState): void {
    if (s.flow !== this.cache.flow) {
      const prevFlow = this.cache.flow;
      this.cache.flow = s.flow;
      this.cancelCountUp();
      this.showFlow(s.flow);
      if (s.flow === "playing") {
        this.maybeShowControlsHint();
        // a run/next level began (startLevel ran): every entry into playing
        // except resume from pause; mid-run level-ups covered by the diff below
        if (prevFlow !== "paused") this.showLevelBanner(s.level);
      }
      if (s.flow === "gameover") {
        this.renderBest(s.best, s.newBest);
        this.countUp(this.overScore, s.score);
      } else if (s.flow === "clear") {
        this.countUp(this.clearScore, s.score);
      }
    }
    if (s.score !== this.cache.score) {
      this.cache.score = s.score;
      this.scoreEl.textContent = padScore(s.score);
      this.pop(this.scorePanel);
    }
    if (s.lives !== this.cache.lives) {
      this.cache.lives = s.lives;
      this.renderLives(s.lives);
    }
    if (s.level !== this.cache.level) {
      this.cache.level = s.level;
      this.depthEl.textContent = padLevel(s.level);
      this.pop(this.depthChip);
      // banner only mid-play: skips the boot-time -1→1 diff carried by the menu
      if (s.flow === "playing") this.showLevelBanner(s.level);
    }
    if (s.hasGun !== this.cache.hasGun) {
      this.cache.hasGun = s.hasGun;
      this.gunChip.classList.toggle("is-armed", s.hasGun);
    }
    if (s.fuel !== this.cache.fuel || s.fuelMax !== this.cache.fuelMax) {
      this.cache.fuel = s.fuel;
      this.cache.fuelMax = s.fuelMax;
      const n = fuelFrac(s.fuel, s.fuelMax);
      this.fuelFill.style.transform = `scaleX(${n.toFixed(4)})`;
      this.fuelPct.textContent = `${Math.round(n * 100)}%`;
    }
    if (s.lowFuel !== this.cache.lowFuel) {
      const warn = fuelWarningEdge(this.cache.lowFuel, s.lowFuel);
      this.cache.lowFuel = s.lowFuel;
      this.jetPanel.classList.toggle("is-low", s.lowFuel);
      if (warn) this.toast("FUEL LOW", warn);
    }
    if (s.best !== this.cache.best || s.newBest !== this.cache.newBest) {
      this.cache.best = s.best;
      this.cache.newBest = s.newBest;
      this.renderBest(s.best, s.newBest);
    }
    this.syncMenuProgress(s.score, s.level);
  }

  /** Floating pickup/notification toast. Bottom-center, max 3 stacked. */
  toast(text: string, kind: "item" | "info" | "warn" = "info"): void {
    const el = document.createElement("div");
    el.className = `ddui-toast is-${kind}`;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    const entry: ToastEntry = { el, hideTimer: 0, dead: false };
    entry.hideTimer = this.later(() => this.retireToast(entry), 2600);
    this.toasts.push(entry);
    while (this.toasts.length > 3) {
      const oldest = this.toasts.shift();
      if (oldest) this.retireToast(oldest);
    }
    window.requestAnimationFrame(() => {
      if (entry.el.isConnected) entry.el.classList.add("is-in");
    });
  }

  setMuted(m: boolean): void {
    if (m === this.cache.muted) return;
    this.cache.muted = m;
    this.soundPill.classList.toggle("is-muted", m);
    this.soundPill.setAttribute("aria-pressed", m ? "true" : "false");
    this.soundValue.textContent = m ? "OFF" : "ON";
  }

  // --- guidance: level banner / controls hint / best surfaces / count-up ----------

  /** DEPTH NN banner mid-play; a repeated level diff re-arms the auto-dismiss. */
  private showLevelBanner(level: number): void {
    this.bannerEl.textContent = `DEPTH ${padLevel(level)} — FIND THE TROPHY · OPEN THE EXIT`;
    this.bannerEl.classList.add("is-on");
    if (this.bannerTimer) {
      window.clearTimeout(this.bannerTimer);
      this.pendingTimers.delete(this.bannerTimer);
    }
    this.bannerTimer = this.later(() => {
      this.bannerTimer = 0;
      this.bannerEl.classList.remove("is-on");
    }, 2600);
  }

  /** Once per page load, on the first "playing" entry, only without the stored marker. */
  private maybeShowControlsHint(): void {
    if (this.hintShown) return;
    this.hintShown = true;
    let hinted = false;
    try { hinted = localStorage.getItem(HINT_STORAGE_KEY) !== null; } catch { /* store unusable → show anyway */ }
    if (hinted) return;
    try { localStorage.setItem(HINT_STORAGE_KEY, "1"); } catch { /* noop, as BestScore */ }
    if (window.matchMedia("(pointer: coarse)").matches) {
      this.tag("span", "", this.hintEl).textContent =
        "HOLD PADS TO MOVE · TAP FIRE TO SHOOT · JUMP + JETPACK ON THE RIGHT";
    } else {
      for (const [key, label] of [["←→", "MOVE"], ["SPACE", "JUMP"], ["CTRL", "JETPACK"], ["SHIFT", "FIRE"]] as const) {
        this.hintEl.appendChild(this.hint(key, label));
      }
    }
    window.requestAnimationFrame(() => {
      if (this.hintEl.isConnected) this.hintEl.classList.add("is-on");
    });
    this.hintTimer = this.later(() => {
      this.hintTimer = 0;
      this.hintEl.classList.remove("is-on");
    }, 6000);
  }

  /** Any key/pointer gesture ends the hint early (capture listeners call this). */
  private dismissHint(): void {
    if (!this.hintTimer) return;
    window.clearTimeout(this.hintTimer);
    this.pendingTimers.delete(this.hintTimer);
    this.hintTimer = 0;
    this.hintEl.classList.remove("is-on");
  }

  /** Best-score surfaces: menu foot line (best > 0 only) + game-over best row/badge. */
  private renderBest(best: number, newBest: boolean): void {
    const text = `BEST ${padScore(best)}`;
    this.menuBest.textContent = text;
    this.menuBest.classList.toggle("is-hidden", best <= 0);
    this.overBest.textContent = text;
    this.overBestBadge.classList.toggle("is-on", newBest && best > 0);
    if (newBest && best > 0) this.pop(this.overBestBadge);
  }

  /** Card score counts 0→target over ~0.8s cubic ease-out; last frame is exact. */
  private countUp(el: HTMLElement, target: number): void {
    this.cancelCountUp();
    if (this.prefersReducedMotion || target <= 0) {
      el.textContent = padScore(target);
      return;
    }
    const start = performance.now();
    const duration = 800;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = padScore(Math.round(target * (1 - Math.pow(1 - t, 3))));
      this.countRaf = t < 1 ? window.requestAnimationFrame(tick) : 0;
    };
    this.countRaf = window.requestAnimationFrame(tick);
  }

  private cancelCountUp(): void {
    if (!this.countRaf) return;
    window.cancelAnimationFrame(this.countRaf);
    this.countRaf = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    this.motionMq?.removeEventListener("change", this.onMotionPreferenceChange);
    this.cancelCountUp();
    for (const id of this.pendingTimers) window.clearTimeout(id);
    this.pendingTimers.clear();
    this.toasts = [];
    this.rootEl.remove(); // the injected <style> is inside rootEl → removed with it
  }

  // --- event wiring -----------------------------------------------------------
  // Capture-phase decision table by flow: the menu owns its keys (split again by
  // the new-game confirm dialog), an open dialog owns Tab, everything else passes
  // through to game.ts unchanged (P/ESC pause, M sound, R restart…).
  private onKeyDown = (e: KeyboardEvent): void => {
    this.cb.onGesture();
    this.dismissHint();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.cache.flow === "menu") {
      if (this.confirmOpen) this.onConfirmKey(e);
      else this.onMenuKey(e);
    } else if (this.openModal && e.code === "Tab") {
      this.trapTab(e, this.modalScreen(this.openModal));
    }
  };

  private onMenuKey(e: KeyboardEvent): void {
    switch (e.code) {
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        this.move(-1);
        return;
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        this.move(1);
        return;
      case "Tab":
        // roving tabindex: Tab/Shift+Tab walk the same selection as the arrows
        e.preventDefault();
        e.stopPropagation();
        this.move(e.shiftKey ? -1 : 1);
        this.menuItems[this.sel]?.el.focus();
        return;
      case "Enter":
      case "NumpadEnter":
        // capture-phase hijack: in the menu, Enter activates the selection
        // (game.ts's bubble-phase start-on-Enter is suppressed for non-start items)
        e.preventDefault();
        e.stopPropagation();
        this.activate();
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (this.howtoOpen) this.setHowto(false);
        return;
      default:
        return; // M and other keys pass through to game.ts
    }
  }

  /** Key table while the new-game confirm is open: the menu model stays frozen. */
  private onConfirmKey(e: KeyboardEvent): void {
    switch (e.code) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.closeConfirm(true);
        return;
      case "Enter":
      case "NumpadEnter":
        e.preventDefault();
        e.stopPropagation();
        this.confirmNewGame();
        return;
      case "Tab":
        this.trapTab(e, this.confirmEl);
        return;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        e.stopPropagation(); // selection must not move under the dialog
        return;
      default:
        return; // other keys (M…) pass through as in the plain menu
    }
  }

  /** Focus trap: while a dialog is open, Tab cycles among its scope's buttons and never escapes. */
  private trapTab(e: KeyboardEvent, scope: HTMLElement): void {
    const btns = Array.from(scope.querySelectorAll<HTMLButtonElement>(".ddui-btn"));
    if (btns.length === 0) return;
    const dir = e.shiftKey ? -1 : 1;
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = idx < 0 ? btns[dir < 0 ? btns.length - 1 : 0] : btns[(idx + dir + btns.length) % btns.length];
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }

  private onMotionPreferenceChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
  };

  /** Guard for JS-driven animation steps (count-up, banner…); CSS handles its own override. */
  private get prefersReducedMotion(): boolean {
    return this.reducedMotion;
  }

  private onPointerDown = (): void => {
    this.cb.onGesture();
    this.dismissHint();
  };

  // --- flow / screens -----------------------------------------------------------
  private showFlow(f: Flow): void {
    if (this.booted) {
      this.applyFlow(f);
      return;
    }
    // first paint: defer one frame so the entrance transition actually runs
    this.booted = true;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => this.applyFlow(this.cache.flow)),
    );
  }

  private applyFlow(f: Flow): void {
    this.menuEl.classList.toggle("is-on", f === "menu");
    this.hudEl.classList.toggle("is-on", f === "playing" || f === "paused" || f === "clear");
    this.pauseEl.classList.toggle("is-on", f === "paused");
    this.overEl.classList.toggle("is-on", f === "gameover");
    this.clearEl.classList.toggle("is-on", f === "clear");
    if (f !== "menu") this.closeConfirm(false); // leaving the menu never leaves the dialog behind
    this.syncModalFocus(f);
    if (f === "menu") this.rebuildMenuItems();
  }

  /** Dialog focus management (runs on flow changes only): stash focus when a
   *  modal opens and move it to the primary button, restore on close. */
  private syncModalFocus(f: Flow): void {
    const modal = f === "paused" || f === "gameover" || f === "clear" ? f : null;
    if (modal) {
      if (!this.openModal) {
        this.modalRestore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      this.openModal = modal;
      this.primaryOf(modal).focus();
    } else if (this.openModal) {
      this.openModal = null;
      const restore = this.modalRestore;
      this.modalRestore = null;
      if (restore?.isConnected) restore.focus();
    }
  }

  private primaryOf(modal: Flow): HTMLButtonElement {
    return modal === "paused" ? this.pausePrimary : modal === "gameover" ? this.overPrimary : this.clearPrimary;
  }

  private modalScreen(modal: Flow): HTMLElement {
    return modal === "paused" ? this.pauseEl : modal === "gameover" ? this.overEl : this.clearEl;
  }

  // --- menu model -----------------------------------------------------------------
  private addItem(el: HTMLButtonElement, action: () => void): void {
    const item: MenuItem = { el, action };
    this.allItems.push(item);
    el.addEventListener("pointerenter", () => this.selectItem(item));
    el.addEventListener("focus", () => this.selectItem(item)); // Tab focus and selection stay in sync
    el.addEventListener("click", () => {
      this.selectItem(item);
      item.action();
    });
  }

  private rebuildMenuItems(): void {
    this.menuItems = this.allItems.filter(it => !it.el.classList.contains("is-hidden"));
    if (this.sel >= this.menuItems.length) this.sel = Math.max(0, this.menuItems.length - 1);
    this.applySelection();
  }

  private applySelection(): void {
    this.menuItems.forEach((it, i) => {
      const selected = i === this.sel;
      it.el.classList.toggle("is-selected", selected);
      it.el.tabIndex = selected ? 0 : -1; // roving tabindex
      if (selected) it.el.setAttribute("aria-current", "true");
      else it.el.removeAttribute("aria-current");
    });
  }

  private selectItem(item: MenuItem): void {
    const idx = this.menuItems.indexOf(item);
    if (idx >= 0 && idx !== this.sel) {
      this.sel = idx;
      this.applySelection();
    }
  }

  private move(dir: number): void {
    const len = this.menuItems.length;
    if (len === 0) return;
    this.sel = (this.sel + dir + len) % len;
    this.applySelection();
  }

  private activate(): void {
    const item = this.menuItems[this.sel];
    if (item) item.action();
  }

  private setHowto(open: boolean): void {
    this.howtoOpen = open;
    this.howtoEl.classList.toggle("is-open", open);
    this.howtoItem.classList.toggle("is-open", open);
  }

  /** NEW GAME action: a saved run gets the confirm dialog, none starts at once. */
  private requestNewGame(): void {
    if (shouldConfirmNewGame(this.hasSave)) this.openConfirm();
    else this.cb.onStart();
  }

  private openConfirm(): void {
    if (this.confirmOpen) return;
    this.confirmOpen = true;
    this.confirmEl.classList.add("is-open");
    this.confirmRestore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.confirmPrimary.focus();
  }

  /** Closes the dialog; focus returns to the opener unless the flow moved on. */
  private closeConfirm(restoreFocus: boolean): void {
    if (!this.confirmOpen) return;
    this.confirmOpen = false;
    this.confirmEl.classList.remove("is-open");
    const restore = this.confirmRestore;
    this.confirmRestore = null;
    if (restoreFocus && restore?.isConnected) restore.focus();
  }

  private confirmNewGame(): void {
    this.closeConfirm(true);
    this.cb.onStartConfirmed();
  }

  /** CONTINUE visibility + sublabel, inferred from the restored run state. */
  private syncMenuProgress(score: number, level: number): void {
    const hasSave = score > 0 || level > 1;
    this.hasSave = hasSave;
    const sig = `${hasSave ? 1 : 0}:${score}:${level}`;
    if (sig === this.menuSig) return;
    this.menuSig = sig;
    this.continueBtn.classList.toggle("is-hidden", !hasSave);
    if (hasSave) this.continueSub.textContent = `DEPTH ${padLevel(level)} · ${score} PTS`;
    this.rebuildMenuItems();
  }

  // --- hud pieces -----------------------------------------------------------------
  private renderLives(lives: number): void {
    const count = Math.max(4, lives);
    if (count !== this.pipCount) {
      this.pipCount = count;
      this.pipsEl.replaceChildren();
      for (let i = 0; i < count; i++) this.tag("span", "ddui-pip", this.pipsEl);
    }
    const pips = this.pipsEl.children;
    for (let i = 0; i < pips.length; i++) pips[i]?.classList.toggle("is-filled", i < lives);
  }

  private pop(el: HTMLElement): void {
    el.classList.remove("is-pop");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("is-pop");
  }

  // --- toasts ----------------------------------------------------------------------
  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
    return id;
  }

  private retireToast(entry: ToastEntry): void {
    if (entry.dead) return;
    entry.dead = true;
    window.clearTimeout(entry.hideTimer);
    entry.el.classList.remove("is-in");
    entry.el.classList.add("is-out");
    this.later(() => entry.el.remove(), 460);
  }

  // --- DOM builders -----------------------------------------------------------------
  private tag<K extends keyof HTMLElementTagNameMap>(name: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
    const el = document.createElement(name);
    el.className = cls;
    parent?.appendChild(el);
    return el;
  }

  private div(cls: string, parent?: HTMLElement): HTMLDivElement {
    return this.tag("div", cls, parent);
  }

  private button(cls: string, parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const btn = this.tag("button", cls, parent);
    btn.type = "button";
    btn.tabIndex = -1;
    btn.textContent = label;
    btn.addEventListener("click", action);
    return btn;
  }

  private buildMenuItem(parent: HTMLElement, label: string): { btn: HTMLButtonElement; main: HTMLDivElement; value: HTMLSpanElement } {
    const btn = this.tag("button", "ddui-item", parent);
    btn.type = "button";
    btn.tabIndex = -1; // selection is managed by the UI, not tab order
    const main = this.div("ddui-item-main", btn);
    this.tag("span", "ddui-item-label", main).textContent = label;
    const value = this.tag("span", "ddui-item-value", btn);
    return { btn, main, value };
  }

  private buildCard(screen: HTMLElement, titleId: string, overline: string, title: string): HTMLDivElement {
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-modal", "true");
    screen.setAttribute("aria-labelledby", titleId);
    this.div("ddui-backdrop", screen);
    const card = this.div("ddui-panel ddui-card", screen);
    this.div("ddui-overline", card).textContent = overline;
    const titleEl = this.tag("h2", "ddui-card-title", card);
    titleEl.id = titleId;
    titleEl.textContent = title;
    return card;
  }

  private buildHowto(parent: HTMLElement): HTMLDivElement {
    const panel = this.div("ddui-panel ddui-howto", parent);
    this.tag("h3", "", panel).textContent = "CONTROLS";
    const rows: Array<[string, string[]]> = [
      ["MOVE", ["←→", "A", "D"]],
      ["JUMP", ["↑", "W", "SPACE"]],
      ["FIRE", ["SHIFT", "ALT"]],
      ["JETPACK", ["CTRL"]],
      ["PAUSE", ["P", "ESC"]],
      ["SOUND", ["M"]],
      ["START", ["ENTER"]],
    ];
    for (const [name, keys] of rows) {
      const row = this.div("ddui-howto-row", panel);
      this.tag("span", "", row).textContent = name;
      const keysEl = this.div("ddui-howto-keys", row);
      for (const k of keys) keysEl.appendChild(this.kbd(k));
    }
    return panel;
  }

  /** New-game confirm — a sibling overlay of the howto panel inside the menu
   *  screen, so no flow change is involved and the save is never touched here. */
  private buildConfirm(parent: HTMLElement): { overlay: HTMLDivElement; primary: HTMLButtonElement } {
    const overlay = this.div("ddui-confirm", parent);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ddui-confirm-title");
    const backdrop = this.div("ddui-backdrop", overlay);
    const card = this.div("ddui-panel ddui-card", overlay);
    this.div("ddui-overline", card).textContent = "UNFINISHED DESCENT";
    const title = this.tag("h2", "ddui-card-title", card);
    title.id = "ddui-confirm-title";
    title.textContent = "START OVER?";
    this.div("ddui-confirm-note", card).textContent = "This overwrites your saved descent.";
    const row = this.div("ddui-btnrow", card);
    const primary = this.button("ddui-btn ddui-btn--primary", row, "NEW GAME", () => this.confirmNewGame());
    this.button("ddui-btn", row, "CANCEL", () => this.closeConfirm(true));
    overlay.addEventListener("click", e => {
      if (e.target === backdrop) this.closeConfirm(true); // backdrop click = cancel
    });
    return { overlay, primary };
  }

  private kbd(text: string): HTMLElement {
    const el = this.tag("kbd", "ddui-kbd");
    el.textContent = text;
    return el;
  }

  private hint(key: string, label: string): HTMLElement {
    const span = this.tag("span", "");
    if (key) span.appendChild(this.kbd(key));
    this.tag("span", "", span).textContent = label;
    return span;
  }
}
