#!/usr/bin/env bun

import { spawn, type ChildProcess } from 'node:child_process';
import { host, isPortOpen, localDatabaseUrl, port } from './local-database';

const children: ChildProcess[] = [];
let shuttingDown = false;

function start(label: string, command: string, args: string[], env = process.env, detached = false) {
  const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], env, detached });
  child.stdout?.on('data', (data) => process.stdout.write(`[${label}] ${data}`));
  child.stderr?.on('data', (data) => process.stderr.write(`[${label}] ${data}`));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[${label}] exited (${signal || code})`);
      void shutdown(code || 1);
    }
  });
  children.push(child);
  return child;
}

async function waitForPort(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PGlite socket did not become ready on ${host}:${port}`);
}

function stop(group: ChildProcess[]) {
  for (const child of group) child.kill('SIGTERM');
  return Promise.all(group.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }));
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 5_000).unref();
  // Stop the database last so the worker can finish and record its in-flight jobs.
  const [database, ...clients] = children;
  await stop(clients);
  await stop([database]);
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

if (await isPortOpen()) {
  console.error(`[DEV] ${host}:${port} is already in use. Stop the process using it or set PGLITE_PORT to a free port.`);
  process.exit(1);
}

console.log('[DEV] Starting the local PGlite owner...');
// Detached so a terminal Ctrl-C reaches the database only through shutdown(), after its clients.
start('DB', 'bun', ['run', 'scripts/start-database.ts'], { ...process.env, NODE_ENV: 'development' }, true);
await waitForPort();

const appEnv = { ...process.env, DATABASE_URL: localDatabaseUrl };
console.log(`[DEV] Database ready; starting web and worker against ${localDatabaseUrl}`);
start('NEXT', 'bun', ['next', 'dev'], appEnv);
start('WORKER', 'bun', ['run', 'src/workers/main.ts'], appEnv);
