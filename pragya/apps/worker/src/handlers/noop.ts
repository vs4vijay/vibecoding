import type { Handler } from "./index";

export const noopHandler: Handler = async (job) => {
  const sleepMs = Number(job.payload?.sleep_ms ?? 1000);
  await new Promise((r) => setTimeout(r, sleepMs));
  return { status: "succeeded", result: { slept_ms: sleepMs } };
};
