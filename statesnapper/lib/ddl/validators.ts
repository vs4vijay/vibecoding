// User-input identifiers (source names, column names) are tightly bounded.
export const USER_IDENT_RE = /^[a-z][a-z0-9_]{0,39}$/;

// Postgres NAMEDATALEN default is 63 — derived names (table_versions, indexes)
// must fit. Same character class, longer max.
export const PG_IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

export const ALLOWED_TYPES = new Set([
  "text",
  "integer",
  "bigint",
  "boolean",
  "numeric",
  "timestamptz",
  "date",
  "jsonb",
]);

export type TypedColumn = {
  name: string;
  jsonpath: string;
  sql_type: string;
  indexed?: boolean;
};

export function validateUserIdent(name: string, role = "identifier"): string {
  if (!USER_IDENT_RE.test(name)) {
    throw new Error(`invalid ${role}: ${JSON.stringify(name)} (must match ${USER_IDENT_RE})`);
  }
  return name;
}

export function validatePgIdent(name: string, role = "identifier"): string {
  if (!PG_IDENT_RE.test(name)) {
    throw new Error(`invalid ${role}: ${JSON.stringify(name)} (must match ${PG_IDENT_RE})`);
  }
  return name;
}

export function validateType(sqlType: string): string {
  const t = sqlType.toLowerCase();
  if (!ALLOWED_TYPES.has(t)) {
    throw new Error(`disallowed sql_type: ${sqlType}. Allowed: ${[...ALLOWED_TYPES].join(", ")}`);
  }
  return t;
}

export function validateTypedColumns(cols: unknown): TypedColumn[] {
  if (!Array.isArray(cols)) {
    throw new Error("typed_columns must be an array");
  }
  return cols.map((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new Error(`typed_columns[${i}] must be an object`);
    }
    const r = c as any;
    return {
      name: validateUserIdent(r.name, `typed_columns[${i}].name`),
      jsonpath: requireString(r.jsonpath, `typed_columns[${i}].jsonpath`),
      sql_type: validateType(r.sql_type),
      indexed: !!r.indexed,
    };
  });
}

function requireString(v: unknown, role: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${role} must be a non-empty string`);
  }
  return v;
}

export function quoteIdent(name: string): string {
  validatePgIdent(name);
  return `"${name}"`;
}

export function escapeText(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function pathToTopLevelKey(jsonpath: string): string {
  const m = /^\$\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(jsonpath);
  if (!m) {
    throw new Error(
      `typed_columns: jsonpath ${JSON.stringify(jsonpath)} must be a top-level $.<Key> expression`
    );
  }
  return m[1];
}

// Back-compat re-exports
export const IDENT_RE = USER_IDENT_RE;
export const validateIdent = validateUserIdent;
