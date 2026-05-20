import { getConfig } from "./config";

const HEADER = "x-internal-secret";

export function checkInternalAuth(req: Request): { ok: boolean; reason?: string } {
  const cfg = getConfig();
  const got = req.headers.get(HEADER);
  if (!got) return { ok: false, reason: "missing internal secret header" };
  if (got !== cfg.INTERNAL_SHARED_SECRET) return { ok: false, reason: "bad internal secret" };
  return { ok: true };
}
