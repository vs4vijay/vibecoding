import { z } from "zod";

const PreRequestCaptureSchema = z.object({
  from: z.enum(["cookie"]),                 // for now only cookies
  name: z.string().min(1),                  // cookie name
  to: z.string().min(1),                    // "headers.X-XSRF-TOKEN" or "cookies.JSESSIONID"
});

const PreRequestSchema = z.object({
  method: z.enum(["GET", "POST"]).optional(),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  captures: z.array(PreRequestCaptureSchema).min(1),
});

const HttpConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  params: z.record(z.union([z.string(), z.number()])).optional(),
  form: z.record(z.union([z.string(), z.number()])).optional(),
  body: z.any().optional(),
  pre_request: PreRequestSchema.optional(),
  // Set true when the source's TLS cert chain isn't in Node's trust store
  // (corporate proxies, gov-issued certs, etc.). Scoped to the source — far safer
  // than the process-wide NODE_TLS_REJECT_UNAUTHORIZED=0 env var.
  insecure_tls: z.boolean().optional(),
});

const PaginationSchema = z.discriminatedUnion("style", [
  z.object({ style: z.literal("none") }),
  z.object({
    style: z.literal("page"),
    page_param: z.string(),
    size_param: z.string().optional(),
    size: z.number().int().positive().optional(),
    start_page: z.number().int().nonnegative().optional(),
    stop_when: z.literal("empty_records").optional(),
    max_pages: z.number().int().positive().optional(),
  }),
  z.object({
    style: z.literal("offset"),
    offset_param: z.string(),
    size_param: z.string().optional(),
    size: z.number().int().positive(),
    start_offset: z.number().int().nonnegative().optional(),
    stop_when: z.literal("empty_records").optional(),
    max_pages: z.number().int().positive().optional(),
  }),
  z.object({
    // F3 "values": iterate a fixed list of opaque codes into a `{{value}}` URL template.
    // Each iteration is independent; we don't stop on empty_records (each shard's emptiness
    // is unrelated to the next). max_pages caps the iteration as a safety net.
    style: z.literal("values"),
    values: z.array(z.string().min(1)).min(1),
    max_pages: z.number().int().positive().optional(),
  }),
]);

const DisplayColumnSchema = z.object({
  label: z.string().min(1),
  jsonpath: z.string().min(1),
  primary: z.boolean().optional(),
});

const LocationConfigSchema = z.object({
  mode: z.enum(["none", "query", "form", "body", "path"]).default("none"),
  // For mode in {query, form, body}: the parameter / json-key name on the upstream request.
  field: z.string().min(1).optional(),
  // Optional value maps so the operator picks human slugs ("ajmer") and the upstream
  // receives the canonical value the API expects ("16").
  city_values: z.record(z.union([z.string(), z.number()])).optional(),
  state_values: z.record(z.union([z.string(), z.number()])).optional(),
  // For mode=="path": Mustache-ish template — {{ location.city }}, {{ location.state }}.
  // Rendered into http.url (with %-encoding) before the request fires.
  templated: z.string().optional(),
  // If true and the operator omits a location at runtime, the pipeline fetches the
  // source's full inventory. If false, the run errors out with LOCATION_REQUIRED.
  supports_all: z.boolean().default(true),
});

export type LocationConfig = z.infer<typeof LocationConfigSchema>;

export const RunLocationSchema = z.object({
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
}).optional();
export type RunLocation = z.infer<typeof RunLocationSchema>;

const DedupConfigSchema = z.object({
  key_fields: z.array(
    z.object({
      path: z.string().min(1),
      normalize: z.enum(["address", "round_1000", "round_10000", "date_week", "pincode", "bank", "lower", "identity"]).optional(),
    })
  ).min(1),
  similarity_threshold: z.number().min(0).max(1).optional(),
  compare_fields: z.array(z.string().min(1)).optional(),
});

export const SourceCreateSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "lowercase letters/digits/underscore; must start with a letter"),
  enabled: z.boolean().optional(),
  category: z.string().min(1).max(64).optional(),
  http: HttpConfigSchema,
  pagination: PaginationSchema,
  records_path: z.string().min(1),
  external_id_path: z.string().min(1),
  hash_fields: z.array(z.string()).nullable().optional(),
  schedule_cron: z.string().nullable().optional(),
  storage_mode: z.enum(["generic", "dedicated"]).optional(),
  typed_columns: z.array(z.any()).optional(),
  storage_table: z.string().optional(),
  display_columns: z.array(DisplayColumnSchema).optional(),
  location: LocationConfigSchema.optional(),
  dedup: DedupConfigSchema.optional(),
  cross_dedup: z.object({
    pincode: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    price: z.string().min(1).optional(),
    bank: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
  }).optional(),
});

export type DisplayColumn = z.infer<typeof DisplayColumnSchema>;

export type SourceCreateInput = z.infer<typeof SourceCreateSchema>;
