import { ofetch } from "ofetch";
import { extractRecords } from "./extract";

export type HttpConfig = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  form?: Record<string, string | number>;
  body?: unknown;
};

export type PaginationConfig =
  | { style: "none" }
  | {
      style: "page";
      page_param: string;
      size_param?: string;
      size?: number;
      start_page?: number;
      stop_when?: "empty_records";
      max_pages?: number;
    }
  | {
      // Offset-based pagination (DataTables-style). offset_param increments by
      // `size` each request, starting from start_offset (default 0).
      style: "offset";
      offset_param: string;
      size_param?: string;
      size: number;
      start_offset?: number;
      stop_when?: "empty_records";
      max_pages?: number;
    };

export type FetchHook = (page: number, raw: unknown, records: unknown[]) => void | Promise<void>;

function buildFetchInit(http: HttpConfig, extraForm?: Record<string, string | number>) {
  const method = http.method ?? "GET";
  const init: Parameters<typeof ofetch>[1] = {
    method,
    headers: { ...(http.headers ?? {}) },
    retry: 1,
    timeout: 60_000,
    // Force-parse JSON even when server returns text/html — some APIs (e.g. PHP
    // endpoints) reply with JSON bodies under a non-JSON Content-Type.
    parseResponse: (text: string) => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
  const methodAcceptsBody = method !== "GET" && method !== "HEAD";

  // GET/HEAD: pagination params + http.params go into query string. http.form is ignored.
  // Other methods: http.form is sent as form-urlencoded body, pagination params merge in.
  if (!methodAcceptsBody) {
    const query: Record<string, string | number> = { ...(http.params ?? {}), ...(extraForm ?? {}) };
    if (Object.keys(query).length) (init as any).query = query;
    return init;
  }

  if (http.params) (init as any).query = http.params;
  if (http.form || extraForm) {
    const merged = { ...(http.form ?? {}), ...(extraForm ?? {}) };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) params.append(k, String(v));
    (init as any).body = params.toString();
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
    init.headers = headers;
  } else if (http.body !== undefined) {
    (init as any).body = http.body;
  }
  return init;
}

export async function fetchOnePage(
  http: HttpConfig,
  recordsPath: string,
  pagination?: PaginationConfig
): Promise<{ raw: unknown; records: unknown[] }> {
  let extraForm: Record<string, string | number> | undefined;
  if (pagination?.style === "page") {
    const page = pagination.start_page ?? 1;
    extraForm = { [pagination.page_param]: page };
    if (pagination.size_param && pagination.size) {
      extraForm[pagination.size_param] = pagination.size;
    }
  } else if (pagination?.style === "offset") {
    extraForm = { [pagination.offset_param]: pagination.start_offset ?? 0 };
    if (pagination.size_param) extraForm[pagination.size_param] = pagination.size;
  }
  const raw = await ofetch(http.url, buildFetchInit(http, extraForm));
  const records = extractRecords(raw, recordsPath);
  return { raw, records };
}

export async function* paginate(
  http: HttpConfig,
  recordsPath: string,
  pagination: PaginationConfig
): AsyncGenerator<{ page: number; raw: unknown; records: unknown[] }> {
  if (pagination.style === "none") {
    const raw = await ofetch(http.url, buildFetchInit(http));
    yield { page: 1, raw, records: extractRecords(raw, recordsPath) };
    return;
  }

  if (pagination.style === "page") {
    const start = pagination.start_page ?? 1;
    const maxPages = pagination.max_pages ?? 1000;
    for (let p = start; p < start + maxPages; p++) {
      const extra: Record<string, string | number> = { [pagination.page_param]: p };
      if (pagination.size_param && pagination.size) {
        extra[pagination.size_param] = pagination.size;
      }
      const raw = await ofetch(http.url, buildFetchInit(http, extra));
      const records = extractRecords(raw, recordsPath);
      yield { page: p, raw, records };
      if (pagination.stop_when === "empty_records" && records.length === 0) break;
      if (pagination.size && records.length < pagination.size) break;
    }
    return;
  }

  // style === "offset"
  const offsetStart = pagination.start_offset ?? 0;
  const size = pagination.size;
  const maxPages = pagination.max_pages ?? 1000;
  for (let i = 0; i < maxPages; i++) {
    const offset = offsetStart + i * size;
    const extra: Record<string, string | number> = { [pagination.offset_param]: offset };
    if (pagination.size_param) extra[pagination.size_param] = size;
    const raw = await ofetch(http.url, buildFetchInit(http, extra));
    const records = extractRecords(raw, recordsPath);
    yield { page: i + 1, raw, records };
    if (records.length === 0) break;
    if (records.length < size) break;
  }
}
