import { expect, test } from 'bun:test';
import { envSchema, loadConfig } from '../src/config';

test('loads defaults when env is empty', () => {
  const cfg = loadConfig({});
  expect(cfg.DB_BACKEND).toBe('pglite');
  expect(cfg.NODE_ENV).toBe('development');
  expect(cfg.LKML_SOURCE).toBe('patchwork');
  expect(cfg.API_PORT).toBe(5174);
  expect(cfg.WORKER_CONCURRENCY).toBe(2);
});

test('coerces numeric and boolean values', () => {
  const cfg = loadConfig({
    API_PORT: '9000',
    WORKER_CONCURRENCY: '4',
    AUTO_INGEST: 'false',
    SEED_ON_START: 'true',
    LKML_FETCH_LIMIT: '42',
  });
  expect(cfg.API_PORT).toBe(9000);
  expect(cfg.WORKER_CONCURRENCY).toBe(4);
  expect(cfg.AUTO_INGEST).toBe(false);
  expect(cfg.SEED_ON_START).toBe(true);
  expect(cfg.LKML_FETCH_LIMIT).toBe(42);
});

test('fail-fast on invalid enum value', () => {
  expect(() => loadConfig({ DB_BACKEND: 'mysql' })).toThrow(/Invalid environment configuration/);
});

test('fail-fast on invalid number value', () => {
  expect(() => loadConfig({ API_PORT: 'not-a-port' })).toThrow(/Invalid environment configuration/);
});

test('fail-fast on out-of-range value', () => {
  expect(() => loadConfig({ WORKER_CONCURRENCY: '100' })).toThrow(/Invalid environment configuration/);
});

test('DATABASE_URL is required when DB_BACKEND=postgres', () => {
  expect(() => loadConfig({ DB_BACKEND: 'postgres' })).toThrow(/DATABASE_URL/);
});

test('DATABASE_URL accepted when DB_BACKEND=postgres', () => {
  const cfg = loadConfig({ DB_BACKEND: 'postgres', DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
  expect(cfg.DB_BACKEND).toBe('postgres');
  expect(cfg.DATABASE_URL).toBe('postgres://u:p@localhost:5432/db');
});

test('schema rejects unknown DB_BACKEND', () => {
  const parsed = envSchema.safeParse({ DB_BACKEND: 'sqlite' });
  expect(parsed.success).toBe(false);
});
