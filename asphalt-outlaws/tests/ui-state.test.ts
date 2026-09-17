import { describe, expect, test } from "bun:test";
import { AppModel } from "../src/ui/state";
import { BIKES, ECONOMY, LEVELS } from "../src/config";
import type { Results } from "../src/sim/types";

function makeResults(over: Partial<Results> = {}): Results {
  return {
    place: 3,
    totalRacers: 8,
    time: 95.24,
    prize: LEVELS[0]!.prize,
    qualified: true,
    ending: "finished",
    levelIdx: 0,
    ...over,
  };
}

describe("AppModel transitions", () => {
  test("title: confirm goes to select, other actions ignored", () => {
    const app = new AppModel(500);
    app.handleAction("menu-left");
    expect(app.phase).toBe("title");
    app.handleAction("confirm");
    expect(app.phase).toBe("select");
  });

  test("select: confirm fires start-race intent with level + bike", () => {
    const app = new AppModel(500);
    app.handleAction("confirm"); // title -> select
    app.handleAction("confirm"); // select -> intent
    expect(app.intent).toEqual({ type: "start-race", levelIdx: 0, bikeIdx: 0 });
  });

  test("select: menu-left/right cycle with wrap-around", () => {
    const app = new AppModel(500);
    app.handleAction("confirm");
    app.handleAction("menu-right");
    expect(app.bikeIdx).toBe(1);
    app.handleAction("menu-left");
    expect(app.bikeIdx).toBe(0);
    app.handleAction("menu-left");
    expect(app.bikeIdx).toBe(BIKES.length - 1);
    app.handleAction("menu-right");
    expect(app.bikeIdx).toBe(0);
  });

  test("select: back returns to title", () => {
    const app = new AppModel(500);
    app.handleAction("confirm");
    app.handleAction("back");
    expect(app.phase).toBe("title");
  });

  test("paused: confirm and pause resume the race phase", () => {
    const app = new AppModel(500);
    app.setPhase("paused");
    app.handleAction("confirm");
    expect(app.phase).toBe("race");
    app.setPhase("paused");
    app.handleAction("pause");
    expect(app.phase).toBe("race");
  });

  test("paused: back emits quit-to-title intent and returns to title", () => {
    const app = new AppModel(500);
    app.setPhase("paused");
    app.handleAction("back");
    expect(app.intent).toEqual({ type: "quit-to-title" });
    expect(app.phase).toBe("title");
  });

  test("results qualified (not last level): advances level and fires intent", () => {
    const app = new AppModel(500);
    app.career.levelIdx = 2;
    app.showResults(makeResults({ qualified: true, levelIdx: 2 }));
    expect(app.phase).toBe("results");
    app.handleAction("confirm");
    expect(app.career.levelIdx).toBe(3);
    expect(app.intent).toEqual({ type: "start-race", levelIdx: 3, bikeIdx: 0 });
  });

  test("results qualified (last level): goes to credits, no intent", () => {
    const app = new AppModel(500);
    app.career.levelIdx = LEVELS.length - 1;
    app.showResults(makeResults({ qualified: true, levelIdx: LEVELS.length - 1 }));
    app.handleAction("confirm");
    expect(app.phase).toBe("credits");
    expect(app.intent).toBeNull();
  });

  test("results failed: goes to gameover", () => {
    const app = new AppModel(500);
    app.showResults(makeResults({ qualified: false, ending: "busted" }));
    app.handleAction("confirm");
    expect(app.phase).toBe("gameover");
  });

  test("results back abandons to title", () => {
    const app = new AppModel(500);
    app.showResults(makeResults());
    app.handleAction("back");
    expect(app.phase).toBe("title");
  });

  test("gameover retry with funds: deducts fee and fires intent for current level", () => {
    const app = new AppModel(ECONOMY.retryFee + 500);
    app.career.levelIdx = 1;
    // Failed race still banks the consolation prize (LEVELS[0].prize = 1500).
    app.showResults(makeResults({ qualified: false, levelIdx: 1 }));
    expect(app.career.money).toBe(ECONOMY.retryFee + 500 + 1500);
    app.handleAction("confirm"); // results -> gameover
    app.handleAction("confirm"); // gameover -> retry
    expect(app.career.money).toBe(ECONOMY.retryFee + 500 + 1500 - ECONOMY.retryFee);
    expect(app.intent).toEqual({ type: "start-race", levelIdx: 1, bikeIdx: 0 });
  });

  test("gameover without funds: back to title, no deduction", () => {
    const app = new AppModel(ECONOMY.retryFee - 1);
    app.showResults(makeResults({ qualified: false, prize: 0 }));
    app.handleAction("confirm"); // results -> gameover
    app.handleAction("confirm"); // gameover -> title (cannot pay)
    expect(app.phase).toBe("title");
    expect(app.career.money).toBe(ECONOMY.retryFee - 1);
    expect(app.intent).toBeNull();
  });

  test("gameover back returns to title", () => {
    const app = new AppModel(500);
    app.setPhase("gameover");
    app.handleAction("back");
    expect(app.phase).toBe("title");
  });

  test("credits confirm resets career and returns to title", () => {
    const app = new AppModel(500);
    app.career.levelIdx = LEVELS.length - 1;
    app.career.money = 9999;
    app.setPhase("credits");
    app.handleAction("confirm");
    expect(app.career).toEqual({ levelIdx: 0, money: 500 });
    expect(app.phase).toBe("title");
  });

  test("showResults adds prize money and stores results", () => {
    const app = new AppModel(500);
    app.showResults(makeResults({ prize: 3000 }));
    expect(app.career.money).toBe(3500);
    expect(app.lastResults?.prize).toBe(3000);
    expect(app.phase).toBe("results");
  });

  test("canRetry respects the retry fee", () => {
    expect(new AppModel(ECONOMY.retryFee).canRetry()).toBe(true);
    expect(new AppModel(ECONOMY.retryFee - 1).canRetry()).toBe(false);
  });

  test("toggleMute flips and returns the new state", () => {
    const app = new AppModel(500);
    expect(app.muted).toBe(false);
    expect(app.toggleMute()).toBe(true);
    expect(app.muted).toBe(true);
    expect(app.toggleMute()).toBe(false);
  });

  test("onDidChange fires per mutation batch and unsubscribes", () => {
    const app = new AppModel(500);
    let calls = 0;
    const off = app.onDidChange(() => {
      calls++;
    });
    app.handleAction("confirm"); // title -> select: one touch
    expect(calls).toBe(1);
    app.handleAction("confirm"); // intent write: exactly one touch (no double fire)
    expect(calls).toBe(2);
    off();
    app.setPhase("title");
    expect(calls).toBe(2);
  });

  test("race phase ignores all ui actions (main-driven)", () => {
    const app = new AppModel(500);
    app.setPhase("race");
    app.handleAction("confirm");
    app.handleAction("back");
    app.handleAction("menu-left");
    expect(app.phase).toBe("race");
    expect(app.intent).toBeNull();
  });
});
