import { z } from "zod";

const HttpConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  params: z.record(z.union([z.string(), z.number()])).optional(),
  form: z.record(z.union([z.string(), z.number()])).optional(),
  body: z.any().optional(),
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
]);

const DisplayColumnSchema = z.object({
  label: z.string().min(1),
  jsonpath: z.string().min(1),
  primary: z.boolean().optional(),
});

export const SourceCreateSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "lowercase letters/digits/underscore; must start with a letter"),
  enabled: z.boolean().optional(),
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
});

export type DisplayColumn = z.infer<typeof DisplayColumnSchema>;

export type SourceCreateInput = z.infer<typeof SourceCreateSchema>;
