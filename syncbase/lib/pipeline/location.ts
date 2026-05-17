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

  // query | form | body: resolve {field, value}
  if (!cfg.field) throw new Error(`source "${sourceName}": location.field required when mode=${cfg.mode}`);
  const value = resolveValue(runLocation, cfg);
  if (value == null) return http;

  if (cfg.mode === "query") {
    return { ...http, params: { ...(http.params ?? {}), [cfg.field]: value } };
  }
  if (cfg.mode === "form") {
    return { ...http, form: { ...(http.form ?? {}), [cfg.field]: value } };
  }
  // mode === "body"
  const base = http.body;
  if (base != null && (typeof base !== "object" || Array.isArray(base))) {
    throw new Error(`source "${sourceName}": location mode=body requires http.body to be an object`);
  }
  const next = { ...(base as Record<string, unknown> | undefined), [cfg.field]: value };
  return { ...http, body: next };
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
