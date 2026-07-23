export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
}

const allowedEvents = new Set([
  "session_started", "scene_entered", "preparation_selected", "rewire_committed",
  "trace_triggered", "memory_collected", "memory_corrupted", "alert_tier_changed",
  "ending_selected", "session_completed", "performance_sample", "fatal_error",
]);
const allowedPayload = new Set(["scene", "route", "ending", "tier", "memory_id", "fps", "frame_ms", "reason"]);

export function validateBatch(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const batch = value as Record<string, unknown>;
  if (batch.schema_version !== 1 || typeof batch.session_id !== "string" || batch.session_id.length > 64) return false;
  if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > 100) return false;
  return batch.events.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const event = raw as Record<string, unknown>;
    if (typeof event.name !== "string" || !allowedEvents.has(event.name)) return false;
    if (!event.payload || typeof event.payload !== "object") return false;
    return Object.keys(event.payload as object).every((key) => allowedPayload.has(key));
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/events") return new Response("Not found", { status: 404 });
    if (origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    const length = Number(request.headers.get("Content-Length") ?? "0");
    if (length > 65536) return new Response("Payload too large", { status: 413 });
    let batch: Record<string, unknown>;
    try { batch = await request.json() as Record<string, unknown>; } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!validateBatch(batch)) return new Response("Invalid batch", { status: 400 });
    const events = batch.events as Array<Record<string, unknown>>;
    const statement = env.DB.prepare("INSERT INTO events(session_id,event_name,occurred_at,payload_json,expires_at) VALUES(?,?,?,?,datetime('now','+30 days'))");
    await env.DB.batch(events.map((event) => statement.bind(batch.session_id, event.name, event.timestamp, JSON.stringify(event.payload))));
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin } });
  },
};
