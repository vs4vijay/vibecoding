import { Hono } from 'hono';
import { getLeaderboard } from './db/repository.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /leaderboard?limit=20
 * Top players ordered by kd_ratio desc (tie-break total_kills desc).
 * limit is clamped to [1, 100]; missing/garbage values fall back to 20.
 */
const app = new Hono();

app.get('/leaderboard', async (c) => {
  const raw = c.req.query('limit');
  let limit = DEFAULT_LIMIT;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
    }
  }
  const entries = await getLeaderboard(limit);
  return c.json(entries);
});

export default app;
