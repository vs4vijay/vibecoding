import type { AppModel } from "./state";
import { BIKES, ECONOMY, LEVELS } from "../config";

// OWNER: Agent D. DOM screens rendered into #overlay-root. Contract per
// .plan.md §5 and §7. Do not change signatures.
//
// Re-render on every app change (AppModel.onDidChange -> main calls show()).
// "race" clears the overlay entirely; "paused"/"results"/"gameover" show
// their card on top of the frozen frame. Title/select/credits are full
// screens. No external fonts, no images — chunky retro arcade CSS.
// The overlay root element (see index.html) must get the class "active"
// exactly when the current phase should receive pointer events.

const STYLE_ID = "asphalt-outlaws-ui";

const CSS = `
.ao-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:"Arial Black",Impact,sans-serif;color:#f5ead6;text-transform:uppercase;letter-spacing:1px;user-select:none;}
.ao-dim{background:rgba(11,7,16,0.55);}
.ao-logo1,.ao-logo2{font-size:104px;line-height:.85;}
.ao-logo1{color:#ff5b2e;text-shadow:7px 7px 0 #16101f;transform:skewX(-8deg) rotate(-2deg);}
.ao-logo2{color:#f5ead6;text-shadow:7px 7px 0 rgba(0,0,0,.7);transform:skewX(-8deg) rotate(-1deg);}
.ao-tag{font-size:15px;color:#f5ead6;background:#16101f;border:3px solid #f5ead6;padding:7px 16px;transform:rotate(-1deg);box-shadow:6px 6px 0 rgba(0,0,0,.6);}
.ao-panel{background:#16101f;border:3px solid #f5ead6;box-shadow:8px 8px 0 rgba(0,0,0,.55);padding:16px 26px;}
.ao-controls{font-size:13px;line-height:2;color:#f5ead6;transform:rotate(.5deg);}
.ao-controls b{color:#ff5b2e;margin-right:10px;}
.ao-blink{font-size:24px;color:#ffd23c;margin-top:10px;animation:aoblink 1.1s steps(2,end) infinite;}
@keyframes aoblink{50%{opacity:0;}}
.ao-h{font-size:38px;color:#ff5b2e;text-shadow:5px 5px 0 #16101f;transform:rotate(-1.2deg);}
.ao-bikes{display:flex;gap:22px;margin:6px 0;}
.ao-bike{width:252px;padding:16px;background:#16101f;border:3px solid #f5ead6;box-shadow:8px 8px 0 rgba(0,0,0,.55);transform:rotate(-1deg);}
.ao-bike.ao-sel{border-color:#ff5b2e;transform:translateY(-10px) rotate(-1deg);box-shadow:10px 12px 0 rgba(255,91,46,.3);}
.ao-bike h3{font-size:19px;color:#ffd23c;margin:0 0 6px;}
.ao-bike p{font-size:12px;min-height:50px;margin:0 0 8px;color:#cfc4ae;text-transform:none;letter-spacing:0;line-height:1.5;}
.ao-stat{display:flex;align-items:center;gap:8px;font-size:10px;margin-top:6px;}
.ao-stat span{width:62px;}
.ao-bar{flex:1;height:10px;background:#2a2136;border:2px solid #f5ead6;}
.ao-bar i{display:block;height:100%;background:#ff5b2e;}
.ao-foot{font-size:13px;color:#f5ead6;}
.ao-foot b{color:#ffd23c;}
.ao-money{color:#ffd23c;}
.ao-card{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:430px;text-align:center;transform:rotate(-1deg);padding:26px 40px;}
.ao-card h1,.ao-card h2{margin:0;}
.ao-card h2{font-size:40px;}
.ao-end-finished{color:#ffd23c;}
.ao-end-busted{color:#3ec6ff;}
.ao-end-wrecked{color:#ff5b5b;}
.ao-place{font-size:80px;color:#ffd23c;text-shadow:6px 6px 0 rgba(0,0,0,.6);line-height:1;}
.ao-line{font-size:17px;}
.ao-verdict{font-size:19px;color:#ff5b2e;}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag: string, cls?: string, txt?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

/** Bike spec values span roughly 0.7..1.4 — normalize to a 0..1 bar. */
function barWidth(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 0.7) / 0.7));
  return `${Math.round(t * 100)}%`;
}

function statBar(label: string, v: number): HTMLElement {
  const row = el("div", "ao-stat");
  row.append(el("span", undefined, label));
  const bar = el("div", "ao-bar");
  const fill = el("i");
  fill.style.width = barWidth(v);
  bar.append(fill);
  row.append(bar);
  return row;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const tenth = Math.floor((t * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenth}`;
}

function controlsPanel(): HTMLElement {
  const panel = el("div", "ao-panel ao-controls");
  const lines: Array<[string, string]> = [
    ["THROTTLE", "W / ↑"],
    ["BRAKE", "S / ↓"],
    ["STEER", "A / D or ← / →"],
    ["PUNCH LEFT", "J"],
    ["KICK RIGHT", "K"],
    ["PAUSE", "ESC"],
    ["MUTE", "M"],
  ];
  for (const [k, v] of lines) {
    const row = el("div");
    row.append(el("b", undefined, k), document.createTextNode(v));
    panel.append(row);
  }
  return panel;
}

export class ScreenManager {
  private readonly root: HTMLElement;
  private readonly app: AppModel;
  private lastSig = "\u0000";
  private readonly unsubscribe: () => void;

  constructor(root: HTMLElement, app: AppModel) {
    this.root = root;
    this.app = app;
    ensureStyle();
    // Self-subscribing keeps the view in sync; the signature guard below
    // makes extra show() calls (from main) cheap no-ops.
    this.unsubscribe = app.onDidChange(() => this.show());
    this.show();
  }

  /** (Re)render the screen for app.phase. */
  show(): void {
    const app = this.app;
    const phase = app.phase;
    this.root.classList.toggle("active", phase !== "race");
    const sig = [
      phase,
      app.bikeIdx,
      app.career.money,
      app.career.levelIdx,
      app.lastResults
        ? `${app.lastResults.place}:${app.lastResults.qualified}:${app.lastResults.ending}`
        : "-",
    ].join("|");
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    if (phase === "race") {
      this.root.innerHTML = "";
      return;
    }

    const screen = el(
      "div",
      "ao-screen" +
        (phase === "paused" || phase === "results" || phase === "gameover"
          ? " ao-dim"
          : ""),
    );
    switch (phase) {
      case "title": {
        screen.append(
          el("div", "ao-logo1", "ASPHALT"),
          el("div", "ao-logo2", "OUTLAWS"),
          el("div", "ao-tag", "PUNCH FIRST. FINISH RICH."),
          controlsPanel(),
          el("div", "ao-blink", "PRESS ENTER"),
        );
        break;
      }
      case "select": {
        screen.append(el("div", "ao-h", "CHOOSE YOUR MACHINE"));
        const row = el("div", "ao-bikes");
        for (let i = 0; i < BIKES.length; i++) {
          const bike = BIKES[i]!;
          const card = el("div", "ao-bike" + (i === app.bikeIdx ? " ao-sel" : ""));
          card.append(el("h3", undefined, bike.name));
          card.append(el("p", undefined, bike.blurb));
          card.append(
            statBar("SPEED", bike.topSpeedMul),
            statBar("THROTTLE", bike.accelMul),
            statBar("GRIP", bike.steerMul),
            statBar("ARMOR", bike.weight),
          );
          row.append(card);
        }
        screen.append(row);
        const foot = el("div", "ao-foot");
        foot.append(
          el("b", undefined, "←/→ CHOOSE   ENTER RIDE   ESC BACK   "),
          el("span", "ao-money", fmtMoney(app.career.money)),
        );
        screen.append(foot);
        break;
      }
      case "paused": {
        const card = el("div", "ao-panel ao-card");
        card.append(el("h2", undefined, "PAUSED"));
        card.append(el("div", "ao-line", "ENTER RESUME / ESC QUIT RACE"));
        screen.append(card);
        break;
      }
      case "results": {
        const r = app.lastResults;
        if (!r) break;
        const card = el("div", "ao-panel ao-card");
        const endingWord =
          r.ending === "finished" ? "FINISHED" : r.ending === "busted" ? "BUSTED" : "WRECKED";
        card.append(el("h2", `ao-end-${r.ending}`, endingWord));
        card.append(el("div", "ao-place", `P${r.place} / ${r.totalRacers}`));
        card.append(el("div", "ao-line", `TIME ${fmtTime(r.time)}`));
        card.append(el("div", "ao-line ao-money", `+${fmtMoney(r.prize)}`));
        const level = LEVELS[app.career.levelIdx];
        let verdict: string;
        if (r.qualified) {
          verdict =
            app.career.levelIdx + 1 >= LEVELS.length
              ? "LADDER COMPLETE — SEE YOU AT THE TOP"
              : `YOU'RE IN. NEXT: ${LEVELS[app.career.levelIdx + 1]?.name ?? "???"}`;
        } else {
          verdict = `DIDN'T QUALIFY — TOP ${level?.qualifyPlace ?? "?"} NEEDED`;
        }
        card.append(el("div", "ao-verdict", verdict));
        card.append(el("div", "ao-foot", "ENTER CONTINUE"));
        screen.append(card);
        break;
      }
      case "gameover": {
        const card = el("div", "ao-panel ao-card");
        card.append(el("h2", "ao-end-wrecked", "WRECKED THE LADDER"));
        card.append(el("div", "ao-line", `BANK ${fmtMoney(app.career.money)}`));
        card.append(
          el(
            "div",
            "ao-verdict",
            app.canRetry()
              ? `ENTER RETRY (-${fmtMoney(ECONOMY.retryFee)})`
              : "NOT ENOUGH CASH — ESC TITLE",
          ),
        );
        card.append(
          el("div", "ao-foot", app.canRetry() ? "ENTER RETRY / ESC TITLE" : "ESC TITLE"),
        );
        screen.append(card);
        break;
      }
      case "credits": {
        const card = el("div", "ao-panel ao-card");
        card.append(el("h1", "ao-place", "STREETS: YOURS."));
        card.append(el("div", "ao-line", `TOTAL BANKED ${fmtMoney(app.career.money)}`));
        card.append(el("div", "ao-verdict", "THE OUTLAWS WILL REMEMBER YOU"));
        card.append(el("div", "ao-foot", "ENTER TITLE"));
        screen.append(card);
        break;
      }
    }
    this.root.innerHTML = "";
    this.root.append(screen);
  }
}
