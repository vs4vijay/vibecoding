import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import config from './config.js';
import { initDatabase } from './db/index.js';
import { ensureSchema } from './db/migrate.js';
import leaderboardApp from './leaderboard.js';
import { handleOpen, handleClose, handleMessage, startServer } from './websocket/connection.js';

const app = new Hono();

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// API routes
app.get('/api/players', (c) => c.json({ players: [] }));
app.get('/api/matches', (c) => c.json({ matches: [] }));

// Leaderboard (GET /leaderboard)
app.route('/', leaderboardApp);

// Serve client build in production
if (config.nodeEnv === 'production') {
  app.use('/*', serveStatic({ root: '../client/dist' }));
}

// Initialize database
await initDatabase();

// Idempotent schema creation at boot (safe on every restart). Best-effort:
// a DDL failure must not keep the game from serving.
try {
  await ensureSchema();
  console.log('✅ Database schema ensured');
} catch (err) {
  console.error('⚠️ Schema creation failed; continuing without persistence:', err);
}

// Start game loop
startServer();

// Start server with WebSocket support
const server = Bun.serve({
  port: config.serverPort,
  hostname: config.serverHost,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
    }

    return app.fetch(req, server);
  },
  websocket: {
    open(ws) {
      handleOpen(ws);
    },
    close(ws) {
      handleClose(ws);
    },
    message(ws, message) {
      handleMessage(ws, message);
    },
  },
});

console.log(`🎮 Dustline server running at ${server.url}`);
console.log(`📊 WebSocket: ws://${config.serverHost}:${config.serverPort}/ws`);
