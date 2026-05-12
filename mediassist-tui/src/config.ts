import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV_PATH = join(process.cwd(), ".env");

export type EnvShape = {
  MEDIASSIST_USER?: string;
  MEDIASSIST_COOKIE?: string;
  MEDIASSIST_COOKIE_EXPIRES_AT?: string;
  OLLAMA_HOST?: string;
  OLLAMA_MODEL?: string;
};

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(env: Record<string, string>): string {
  return (
    Object.entries(env)
      .map(([k, v]) => `${k}=${needsQuoting(v) ? JSON.stringify(v) : v}`)
      .join("\n") + "\n"
  );
}

function needsQuoting(v: string): boolean {
  return /[\s#"'$`\\]/.test(v) || v.includes("=");
}

export function loadEnv(): EnvShape {
  if (!existsSync(ENV_PATH)) return {};
  const parsed = parseEnv(readFileSync(ENV_PATH, "utf8"));
  // Also hydrate process.env so libraries (e.g. Anthropic SDK) pick it up.
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return parsed as EnvShape;
}

export function saveEnv(patch: Partial<EnvShape>): void {
  const current = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf8")) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete current[k];
    else current[k] = v;
  }
  writeFileSync(ENV_PATH, serializeEnv(current), "utf8");
}

export function requireEnv<K extends keyof EnvShape>(key: K): NonNullable<EnvShape[K]> {
  const env = loadEnv();
  const v = env[key];
  if (!v) throw new Error(`Missing ${key} in .env`);
  return v as NonNullable<EnvShape[K]>;
}
