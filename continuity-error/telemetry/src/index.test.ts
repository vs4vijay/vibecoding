import { describe, expect, test } from "bun:test";
import { validateBatch } from "./index";

describe("telemetry validation", () => {
  test("accepts a whitelisted event", () => {
    expect(validateBatch({ schema_version: 1, session_id: "ephemeral", events: [{ name: "session_started", timestamp: "now", payload: { scene: "opening" } }] })).toBe(true);
  });
  test("rejects free-form and unknown events", () => {
    expect(validateBatch({ schema_version: 1, session_id: "x", events: [{ name: "player_email", payload: { email: "nope" } }] })).toBe(false);
  });
});
