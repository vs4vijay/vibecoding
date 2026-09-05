import { afterEach, describe, expect, it } from "bun:test";
import {
  CHAMP_FORMAT_VERSION,
  CHAMP_POINTS,
  type ChampEntrant,
  type ChampState,
  clearChamp,
  effectiveTotal,
  loadChamp,
  sortStandings,
  storeChamp,
  totalTimeOf,
} from "../src/championship";
import { TRACK_DEFS } from "../src/track";
import { installMemStorage, resetMemStorage } from "./helpers/mem-storage";

// Bun has no localStorage global; championship.ts only touches it inside its
// persistence calls, so a Map-backed shim is enough (no DOM needed).
installMemStorage();

afterEach(() => resetMemStorage());

function entrant(overrides: Partial<ChampEntrant> = {}): ChampEntrant {
  return {
    id: "p1",
    name: "P1",
    color: "#ff0000",
    isPlayer: true,
    points: 0,
    times: [],
    wins: 0,
    ...overrides,
  };
}

function state(overrides: Partial<ChampState> = {}): ChampState {
  return {
    v: CHAMP_FORMAT_VERSION,
    raceIndex: 0,
    twoPlayer: false,
    entrants: [
      entrant(),
      entrant({ id: "ai0", name: "AI 1", isPlayer: false, color: "#00ff00" }),
      entrant({ id: "ai1", name: "AI 2", isPlayer: false, color: "#0000ff" }),
      entrant({ id: "ai2", name: "AI 3", isPlayer: false, color: "#ffff00" }),
    ],
    ...overrides,
  };
}

describe("points table", () => {
  it("awards 10 / 7 / 5 / 3 by finishing position (spec)", () => {
    expect(CHAMP_POINTS).toEqual([10, 7, 5, 3]);
  });
});

describe("effectiveTotal", () => {
  it("sums finished race times only", () => {
    expect(effectiveTotal(entrant({ times: [61.5, 59.2] }))).toBeCloseTo(120.7, 9);
  });

  it("penalizes each DNF instead of rewarding it", () => {
    const clean = effectiveTotal(entrant({ times: [100, 100] }));
    const dnf = effectiveTotal(entrant({ times: [100, null] }));
    expect(dnf).toBeGreaterThan(clean); // a DNF must never look "faster"
    expect(dnf - clean).toBeGreaterThan(9000); // penalty dominates real times
  });

  it("treats an all-DNF history as worse than any realistic total", () => {
    // Two 10-minute races (1200 s total) must still beat two DNFs.
    expect(effectiveTotal(entrant({ times: [null, null] }))).toBeGreaterThan(
      effectiveTotal(entrant({ times: [600, 600] })),
    );
  });
});

describe("totalTimeOf", () => {
  it("is null when nothing was ever finished", () => {
    expect(totalTimeOf(entrant({ times: [null, null] }))).toBeNull();
  });

  it("sums finished totals raw (no DNF penalty)", () => {
    expect(totalTimeOf(entrant({ times: [10, null, 20] }))).toBe(30);
  });
});

describe("sortStandings", () => {
  it("orders by points descending first", () => {
    const a = entrant({ id: "a", points: 7 });
    const b = entrant({ id: "b", points: 10 });
    const c = entrant({ id: "c", points: 3 });
    expect(sortStandings([a, b, c]).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks point ties by total race time ascending, DNFs penalized", () => {
    // Same points; slower-but-finisher must beat a DNF with less clock time.
    const finisher = entrant({ id: "fin", points: 10, times: [100] });
    const dnf = entrant({ id: "dnf", points: 10, times: [null] });
    expect(sortStandings([dnf, finisher])[0].id).toBe("fin");
  });

  it("breaks remaining ties by wins descending", () => {
    const twoWins = entrant({
      id: "2w",
      points: 10,
      times: [60, 60],
      wins: 2,
    });
    const oneWin = entrant({
      id: "1w",
      points: 10,
      times: [60, 60],
      wins: 1,
    });
    expect(sortStandings([oneWin, twoWins])[0].id).toBe("2w");
  });

  it("keeps grid order for a complete tie (stable sort)", () => {
    const a = entrant({ id: "grid1", points: 10, times: [60], wins: 1 });
    const b = entrant({ id: "grid2", points: 10, times: [60], wins: 1 });
    expect(sortStandings([a, b]).map((e) => e.id)).toEqual(["grid1", "grid2"]);
  });
});

describe("persistence round-trip", () => {
  it("stores and loads a mid-series state unchanged", () => {
    const mid = state({
      raceIndex: 2,
      entrants: [
        entrant({ points: 17, times: [70.5, 68.2], wins: 1 }),
        entrant({ id: "ai0", isPlayer: false, points: 12, times: [72.1, null], wins: 1 }),
        entrant({ id: "ai1", isPlayer: false, points: 8, times: [75.0, 74.3] }),
        entrant({ id: "ai2", isPlayer: false, points: 3, times: [null, null] }),
      ],
    });
    storeChamp(mid);
    expect(loadChamp()).toEqual(mid);
  });

  it("clearChamp makes loadChamp return null", () => {
    storeChamp(state());
    clearChamp();
    expect(loadChamp()).toBeNull();
  });
});

describe("loadChamp validation", () => {
  it("returns null when nothing is stored", () => {
    expect(loadChamp()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem("tankracer.champ", "{not json");
    expect(loadChamp()).toBeNull();
  });

  it("rejects raceIndex outside 0..track-count", () => {
    // The upper bound is derived from TRACK_DEFS.length (Task 1.5): all races
    // done (=== length) is valid; one past that is corrupt.
    for (const bad of [-1, -0.5, 1.5, TRACK_DEFS.length + 1, 99]) {
      const s = state({ raceIndex: bad as number });
      s.entrants = s.entrants.map((e) => ({
        ...e,
        times: Array.from({ length: Math.max(0, bad as number) }, () => 60),
      }));
      storeChamp(s);
      expect(loadChamp()).toBeNull();
    }
  });

  it("accepts raceIndex === TRACK_DEFS.length (series complete, pre-podium)", () => {
    const done = state({
      raceIndex: TRACK_DEFS.length,
      entrants: state().entrants.map((e) => ({
        ...e,
        times: Array.from({ length: TRACK_DEFS.length }, () => 60),
      })),
    });
    storeChamp(done);
    expect(loadChamp()).toEqual(done);
  });

  it("rejects a non-boolean twoPlayer flag", () => {
    const s = state({ twoPlayer: "no" as unknown as boolean });
    storeChamp(s);
    expect(loadChamp()).toBeNull();
  });

  it("rejects entrant lists that are not exactly 4 strong", () => {
    const s = state({ entrants: [entrant(), entrant(), entrant()] });
    storeChamp(s);
    expect(loadChamp()).toBeNull();
  });

  it("rejects entrants whose history length ≠ raceIndex", () => {
    const s = state({
      raceIndex: 2,
      entrants: state().entrants.map((e, i) => ({
        ...e,
        times: i === 1 ? [60] : [60, 61], // one entrant short a race
      })),
    });
    storeChamp(s);
    expect(loadChamp()).toBeNull();
  });

  it("rejects non-numeric time entries", () => {
    const s = state({
      raceIndex: 1,
      entrants: state().entrants.map((e) => ({
        ...e,
        times: ["fast" as unknown as number],
      })),
    });
    storeChamp(s);
    expect(loadChamp()).toBeNull();
  });

  it("rejects non-finite points and missing fields", () => {
    const nonFinite = state({
      entrants: state().entrants.map((e) => ({ ...e, points: NaN })),
    });
    storeChamp(nonFinite); // JSON.stringify(NaN) → null
    expect(loadChamp()).toBeNull();

    const missingId = state({
      entrants: state().entrants.map((e, i) => {
        const clone = { ...e };
        if (i === 2) delete (clone as { id?: string }).id;
        return clone as ChampEntrant;
      }),
    });
    storeChamp(missingId);
    expect(loadChamp()).toBeNull();
  });
});
