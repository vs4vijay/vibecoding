#!/usr/bin/env bun

type Round = "comprehension" | "narrative";

type Report = {
  schema_version: number;
  build_id: string;
  session_id: string;
  elapsed_seconds: number;
  completed: boolean;
  preparation: "identity" | "backdoor" | "";
  ending: "free" | "contain" | "";
  issue_codes: string[];
  contains_personal_data: boolean;
  synthetic?: boolean;
  assessment: {
    round: Round;
    unassisted_first_attempt: boolean;
    explained_rewire?: boolean;
    recognized_corruption?: boolean;
    asha_credible?: "yes" | "no" | "uncertain";
    choice_informed?: "yes" | "no" | "uncertain";
    blocker?: boolean;
    save_corruption?: boolean;
    unwinnable?: boolean;
  };
};

const allowedKeys = new Set([
  "schema_version", "build_id", "session_id", "platform", "locale",
  "elapsed_seconds", "completed", "preparation", "ending", "alert_tier",
  "memories_collected", "memories_corrupted", "milestones", "issue_codes",
  "contains_personal_data", "synthetic", "assessment",
]);

export function aggregate(rawReports: unknown[]) {
  const errors: string[] = [];
  const reports: Report[] = [];
  const ids = new Set<string>();

  rawReports.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`report ${index + 1}: expected an object`);
      return;
    }
    const candidate = raw as Partial<Report> & Record<string, unknown>;
    const unknownKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) errors.push(`report ${index + 1}: unknown fields: ${unknownKeys.join(", ")}`);
    if (candidate.schema_version !== 1) errors.push(`report ${index + 1}: unsupported schema`);
    if (candidate.build_id !== "rc1-2026.07.24") errors.push(`report ${index + 1}: wrong build`);
    if (!candidate.session_id || ids.has(candidate.session_id)) errors.push(`report ${index + 1}: missing or duplicate session_id`);
    if (candidate.contains_personal_data !== false) errors.push(`report ${index + 1}: personal-data flag must be false`);
    if (candidate.synthetic === true) errors.push(`report ${index + 1}: synthetic evidence is forbidden`);
    if (!candidate.assessment?.unassisted_first_attempt) errors.push(`report ${index + 1}: not an unassisted first attempt`);
    if (!["comprehension", "narrative"].includes(candidate.assessment?.round ?? "")) errors.push(`report ${index + 1}: invalid round`);
    if (typeof candidate.elapsed_seconds !== "number" || candidate.elapsed_seconds < 0) errors.push(`report ${index + 1}: invalid elapsed_seconds`);
    if (candidate.session_id) ids.add(candidate.session_id);
    reports.push(candidate as Report);
  });

  const valid = errors.length === 0 ? reports : [];
  const comprehension = valid.filter((report) => report.assessment.round === "comprehension");
  const narrative = valid.filter((report) => report.assessment.round === "narrative");
  const completed = valid.filter((report) => report.completed);
  const times = completed.map((report) => report.elapsed_seconds / 60).sort((a, b) => a - b);
  const medianMinutes = times.length
    ? times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2
    : null;
  const rate = (count: number, total: number) => total ? count / total : 0;
  const blockers = valid.filter((report) =>
    report.assessment.blocker || report.assessment.save_corruption || report.assessment.unwinnable
  ).length;

  const metrics = {
    valid_sessions: valid.length,
    comprehension_sessions: comprehension.length,
    narrative_sessions: narrative.length,
    completion_rate: rate(completed.length, valid.length),
    rewire_comprehension_rate: rate(comprehension.filter((report) => report.assessment.explained_rewire).length, comprehension.length),
    corruption_recognition_rate: rate(comprehension.filter((report) => report.assessment.recognized_corruption).length, comprehension.length),
    median_completed_minutes: medianMinutes,
    preparations: [...new Set(valid.map((report) => report.preparation).filter(Boolean))].sort(),
    endings: [...new Set(valid.map((report) => report.ending).filter(Boolean))].sort(),
    blocker_count: blockers,
  };
  const gates = {
    sample_size: comprehension.length >= 5 && narrative.length >= 5,
    completion: metrics.completion_rate >= 0.8,
    rewire_comprehension: metrics.rewire_comprehension_rate >= 0.8,
    corruption_recognition: metrics.corruption_recognition_rate >= 0.8,
    playtime: medianMinutes !== null && medianMinutes >= 30 && medianMinutes <= 45,
    route_coverage: metrics.preparations.includes("identity") && metrics.preparations.includes("backdoor"),
    ending_coverage: metrics.endings.includes("free") && metrics.endings.includes("contain"),
    no_blockers: blockers === 0,
  };

  return { generated_at: new Date().toISOString(), errors, metrics, gates, passed: errors.length === 0 && Object.values(gates).every(Boolean) };
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("Usage: bun scripts/aggregate_playtests.ts <report.json> [...]");
    process.exit(2);
  }
  const reports = await Promise.all(paths.map((path) => Bun.file(path).json()));
  const result = aggregate(reports);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
