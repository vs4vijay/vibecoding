#!/usr/bin/env bun

import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';

const host = process.env.PGLITE_HOST || '127.0.0.1';
const port = Number(process.env.PGLITE_PORT || 5433);
const databaseUrl = `postgresql://postgres@${host}:${port}/postgres`;
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(label: string, command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], env });
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
    const ready = await new Promise<boolean>((resolve) => {
      const socket = connect({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PGlite socket did not become ready on ${host}:${port}`);
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 5_000).unref();
  await Promise.all(children.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }));
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.log('[DEV] Starting the local PGlite owner...');
start('DB', 'bun', ['run', 'scripts/dev-db.ts'], { ...process.env, NODE_ENV: 'development' });
await waitForPort();

const appEnv = { ...process.env, DATABASE_URL: databaseUrl };
console.log(`[DEV] Database ready; starting web and worker against ${databaseUrl}`);
start('NEXT', 'bun', ['next', 'dev'], appEnv);
start('WORKER', 'bun', ['run', 'src/lib/worker.ts'], appEnv);
