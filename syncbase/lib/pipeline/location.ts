import type { LocationConfig, RunLocation } from "../validation";
import type { HttpConfig } from "./fetch";

export class LocationRequiredError extends Error {
  code = "LOCATION_REQUIRED" as const;
  constructor(sourceName: string) {
    super(`source "${sourceName}" requires a location.city or location.state at run time (supports_all=false)`);
    this.name = "LocationRequiredError";
  }
}

/**
 * Merge a runtime {city,state} input into the source's http config based on the
 * source's LocationConfig. Returns a new HttpConfig — never mutates the input.
 *
 * mode==="none"  → http unchanged (default).
 * mode==="query" → field/value added to http.params.
 * mode==="form"  → field/value added to http.form (POST form-urlencoded).
 * mode==="body"  → field/value added to http.body (object only — arrays/raw strings not supported here).
 * mode==="path"  → http.url is replaced with the rendered `templated` string.
 */
export function applyLocation(
  http: HttpConfig,
  location: LocationConfig | null | undefined,
  runLocation: RunLocation,
  sourceName: string
): HttpConfig {
  const cfg = location ?? { mode: "none" as const, supports_all: true };
  if (cfg.mode === "none") return http;

  const hasInput = Boolean(runLocation?.city || runLocation?.state);
  if (!hasInput) {
    if (cfg.supports_all === false) throw new LocationRequiredError(sourceName);
    // supports_all true (or unset → defaults to true): empty location means "fetch all",
    // which we model by not modifying the request.
    return http;
  }

  if (cfg.mode === "path") {
    if (!cfg.templated) throw new Error(`source "${sourceName}": location.templated required when mode=path`);
    const rendered = renderTemplate(cfg.templated, runLocation, cfg);
    return { ...http, url: rendered };
  }

  // query | form | body | body_path: resolve {field, value}
  if (!cfg.field) throw new Error(`source "${sourceName}": location.field required when mode=${cfg.mode}`);
  const rawValue = resolveValue(runLocation, cfg);
  if (rawValue == null) return http;
  // Apply value_template if set: substitute {{value}} into the template.
  const value = cfg.value_template
    ? cfg.value_template.replace(/\{\{\s*value\s*\}\}/g, String(rawValue))
    : rawValue;

  if (cfg.mode === "query") {
    return { ...http, params: { ...(http.params ?? {}), [cfg.field]: value } };
  }
  if (cfg.mode === "form") {
    return { ...http, form: { ...(http.form ?? {}), [cfg.field]: value } };
  }
  if (cfg.mode === "body") {
    const base = http.body;
    if (base != null && (typeof base !== "object" || Array.isArray(base))) {
      throw new Error(`source "${sourceName}": location mode=body requires http.body to be an object`);
    }
    const next = { ...(base as Record<string, unknown> | undefined), [cfg.field]: value };
    return { ...http, body: next };
  }
  // mode === "body_path": deep-clone http.body and set the value at the JSON-pointer / dot path.
  const base = http.body;
  if (base == null) {
    throw new Error(`source "${sourceName}": location mode=body_path requires http.body to be set`);
  }
  const clone = JSON.parse(JSON.stringify(base));
  setAtPath(clone, cfg.field, value, sourceName);
  return { ...http, body: clone };
}

/**
 * Set `value` at the given path inside `obj`. Path syntax:
 *   - JSON Pointer (RFC 6901):  "/searches/0/filter_by"
 *   - Dot/bracket notation:     "searches.0.filter_by", "searches[0].filter_by"
 * Intermediate path segments must already exist; this is intentional — we don't
 * want a typo in `field` to silently create a sibling object.
 */
function setAtPath(obj: any, path: string, value: unknown, sourceName: string): void {
  let segments: (string | number)[];
  if (path.startsWith("/")) {
    segments = path.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  } else {
    segments = path.split(/[.\[\]]/).filter(Boolean);
  }
  let cur: any = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const key = Array.isArray(cur) && /^\d+$/.test(String(seg)) ? Number(seg) : seg;
    if (cur[key as any] == null) {
      throw new Error(`source "${sourceName}": location.field path "${path}" does not exist in http.body (missing segment "${seg}")`);
    }
    cur = cur[key as any];
  }
  const last = segments[segments.length - 1];
  const key = Array.isArray(cur) && /^\d+$/.test(String(last)) ? Number(last) : last;
  cur[key as any] = value;
}

function resolveValue(input: RunLocation, cfg: LocationConfig): string | number | null {
  // city takes priority — most sources expect a single field, and city is more selective.
  if (input?.city != null) {
    const mapped = cfg.city_values?.[input.city.toLowerCase()] ?? cfg.city_values?.[input.city];
    return mapped ?? input.city;
  }
  if (input?.state != null) {
    const mapped = cfg.state_values?.[input.state.toUpperCase()] ?? cfg.state_values?.[input.state];
    return mapped ?? input.state;
  }
  return null;
}

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.|]+)\s*\}\}/g;

function renderTemplate(template: string, input: RunLocation, cfg: LocationConfig): string {
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const [path, ...filters] = expr.split("|").map((s) => s.trim());
    let v: unknown;
    if (path === "location.city") {
      v = input?.city != null ? cfg.city_values?.[input.city.toLowerCase()] ?? cfg.city_values?.[input.city] ?? input.city : "";
    } else if (path === "location.state") {
      v = input?.state != null ? cfg.state_values?.[input.state.toUpperCase()] ?? cfg.state_values?.[input.state] ?? input.state : "";
    } else {
      v = "";
    }
    let s = v == null ? "" : String(v);
    for (const f of filters) s = applyFilter(s, f);
    return encodeURIComponent(s);
  });
}

function applyFilter(value: string, filter: string): string {
  switch (filter) {
    case "slug":
      return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    default:
      return value;
  }
}
