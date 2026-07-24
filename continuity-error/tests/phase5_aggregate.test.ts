import { describe, expect, test } from "bun:test";
import { aggregate } from "../scripts/aggregate_playtests";

const report = (index: number, round: "comprehension" | "narrative") => ({
  schema_version: 1,
  build_id: "rc1-2026.07.24",
  session_id: `session-${index}`,
  elapsed_seconds: 35 * 60,
  completed: true,
  preparation: index % 2 ? "identity" : "backdoor",
  ending: index % 2 ? "free" : "contain",
  issue_codes: [],
  contains_personal_data: false,
  assessment: {
    round,
    unassisted_first_attempt: true,
    explained_rewire: true,
    recognized_corruption: true,
    asha_credible: "uncertain",
    choice_informed: "yes",
  },
});

describe("Phase 5 playtest aggregation", () => {
  test("passes a complete ten-player evidence set", () => {
    const reports = Array.from({ length: 10 }, (_, index) =>
      report(index, index < 5 ? "comprehension" : "narrative")
    );
    const result = aggregate(reports);
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.metrics.median_completed_minutes).toBe(35);
  });

  test("rejects synthetic or personally identifying fields", () => {
    const synthetic = { ...report(1, "comprehension"), synthetic: true, email: "forbidden@example.test" };
    const result = aggregate([synthetic]);
    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toContain("synthetic evidence is forbidden");
    expect(result.errors.join(" ")).toContain("unknown fields: email");
  });

  test("keeps undersized samples pending", () => {
    const result = aggregate([report(1, "comprehension")]);
    expect(result.passed).toBe(false);
    expect(result.gates.sample_size).toBe(false);
  });
});
