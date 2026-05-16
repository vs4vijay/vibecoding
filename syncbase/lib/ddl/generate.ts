import {
  quoteIdent,
  validateUserIdent,
  validateType,
  validateTypedColumns,
  escapeText,
  pathToTopLevelKey,
  type TypedColumn,
} from "./validators";

export type DDLStatement = { kind: string; sql: string };

export function tableNameFor(sourceName: string): string {
  const safe = validateUserIdent(sourceName, "source name");
  return `entities_${safe}`;
}

export function versionsTableNameFor(sourceName: string): string {
  return `${tableNameFor(sourceName)}_versions`;
}

export function generateDedicatedTableDDL(
  sourceName: string,
  typedColumns: unknown
): DDLStatement[] {
  const cols = validateTypedColumns(typedColumns ?? []);
  const table = tableNameFor(sourceName);
  const versions = versionsTableNameFor(sourceName);

  const columnDefs: string[] = cols.map((c) => buildGeneratedColumn(c));
  const tableSql =
    `CREATE TABLE ${quoteIdent(table)} (\n` +
    `  id BIGSERIAL PRIMARY KEY,\n` +
    `  source TEXT NOT NULL,\n` +
    `  external_id TEXT NOT NULL,\n` +
    `  payload JSONB NOT NULL,\n` +
    `  content_hash TEXT NOT NULL,\n` +
    `  version_num INTEGER NOT NULL DEFAULT 1,\n` +
    `  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n` +
    `  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` +
    (columnDefs.length ? `,\n  ${columnDefs.join(",\n  ")}` : "") +
    `,\n  UNIQUE (source, external_id)\n` +
    `);`;

  const versionsSql =
    `CREATE TABLE ${quoteIdent(versions)} (\n` +
    `  id BIGSERIAL PRIMARY KEY,\n` +
    `  entity_id BIGINT NOT NULL,\n` +
    `  version_num INTEGER NOT NULL,\n` +
    `  payload JSONB NOT NULL,\n` +
    `  content_hash TEXT NOT NULL,\n` +
    `  valid_from TIMESTAMPTZ NOT NULL,\n` +
    `  valid_to TIMESTAMPTZ NOT NULL,\n` +
    `  run_id BIGINT\n` +
    `);`;

  const versionsIdxSql = `CREATE INDEX ${quoteIdent(versions + "_entity_id_idx")} ON ${quoteIdent(versions)}(entity_id);`;

  const beforeTrgSql =
    `CREATE TRIGGER ${quoteIdent(table + "_diff_before_trg")}\n` +
    `BEFORE UPDATE ON ${quoteIdent(table)}\n` +
    `FOR EACH ROW EXECUTE FUNCTION entities_diff_before();`;

  const afterTrgSql =
    `CREATE TRIGGER ${quoteIdent(table + "_diff_after_trg")}\n` +
    `AFTER INSERT OR UPDATE ON ${quoteIdent(table)}\n` +
    `FOR EACH ROW EXECUTE FUNCTION entities_diff_after();`;

  const indexes = cols
    .filter((c) => c.indexed)
    .map((c) => ({
      kind: "index" as const,
      sql: `CREATE INDEX ${quoteIdent(table + "_" + c.name + "_idx")} ON ${quoteIdent(table)}(${quoteIdent(c.name)});`,
    }));

  return [
    { kind: "table", sql: tableSql },
    { kind: "table", sql: versionsSql },
    { kind: "index", sql: versionsIdxSql },
    { kind: "trigger", sql: beforeTrgSql },
    { kind: "trigger", sql: afterTrgSql },
    ...indexes,
  ];
}

export function generateDropDedicatedDDL(sourceName: string): DDLStatement[] {
  const table = tableNameFor(sourceName);
  const versions = versionsTableNameFor(sourceName);
  return [
    { kind: "drop", sql: `DROP TABLE IF EXISTS ${quoteIdent(versions)};` },
    { kind: "drop", sql: `DROP TABLE IF EXISTS ${quoteIdent(table)};` },
  ];
}

function buildGeneratedColumn(c: TypedColumn): string {
  const key = pathToTopLevelKey(c.jsonpath);
  const type = validateType(c.sql_type);
  // payload->>'<key>' yields text; cast to the target type via STORED generated column.
  return `${quoteIdent(c.name)} ${type} GENERATED ALWAYS AS ((payload->>${escapeText(key)})::${type}) STORED`;
}
