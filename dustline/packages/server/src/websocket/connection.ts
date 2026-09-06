import type { ClientMessage, ServerMessage, Team } from '@dustline/shared';
import type { ServerGameState } from '../game/types.js';
import { createGameState, addPlayer, removePlayer, queueInput, tick } from '../game/engine.js';
import { toPlayerState } from '../game/player.js';
import { applyRttSample } from '../game/rtt.js';
import config from '../config.js';

/** How often the server probes each connection's round-trip time. */
const RTT_PROBE_INTERVAL_MS = 1000;

interface ClientData {
  playerId: string | null;
  username: string | null;
  team: Team | null;
  connectedAt: number;
  /** Per-connection RTT probe timer; cleared on close. */
  pingTimer: ReturnType<typeof setInterval> | null;
}

const clients = new Map<Bun.ServerWebSocket<any>, ClientData>();
let gameState = createGameState();

function startGameLoop(): void {
  function loop() {
    const snapshot = tick(gameState);
    if (snapshot) {
      broadcast({ type: 'snapshot', snapshot });
    }
    setTimeout(loop, 1000 / 60);
  }
  loop();
}

export function getGameState(): ServerGameState {
  return gameState;
}

export function getActivePlayerCount(): number {
  return gameState.players.size;
}

export function startServer(): void {
  startGameLoop();
}

export function handleOpen(ws: Bun.ServerWebSocket<any>): void {
  const data: ClientData = {
    playerId: null,
    username: null,
    team: null,
    connectedAt: Date.now(),
    pingTimer: null,
  };
  ws.data = data;
  clients.set(ws, data);
  // App-level RTT probe: the client echoes pong with the same timestamp and
  // the server measures the round trip (see game/rtt.ts).
  data.pingTimer = setInterval(() => {
    send(ws, { type: 'ping', t: Date.now() });
  }, RTT_PROBE_INTERVAL_MS);
  console.log(`🔌 Client connected. Total: ${clients.size}`);
}

export function handleClose(ws: Bun.ServerWebSocket<any>): void {
  const data = clients.get(ws);
  if (data?.pingTimer) {
    clearInterval(data.pingTimer);
    data.pingTimer = null;
  }
  if (data?.playerId) {
    removePlayer(gameState, data.playerId);
    broadcast({
      type: 'playerLeft',
      playerId: data.playerId,
    });
  }
  clients.delete(ws);
  console.log(`🔌 Client disconnected. Total: ${clients.size}`);
}

export function handleMessage(ws: Bun.ServerWebSocket<any>, message: string | Buffer): void {
  try {
    const data = clients.get(ws);
    if (!data) return;

    const msg = JSON.parse(message.toString()) as ClientMessage;

    switch (msg.type) {
      case 'join': {
        if (gameState.players.size >= config.maxPlayers) {
          send(ws, { type: 'error', message: 'Server full' });
          return;
        }

        const team = msg.team || 'T';
        const player = addPlayer(gameState, msg.username || 'Player', team);
        data.playerId = player.id;
        data.username = msg.username;
        data.team = team;

        send(ws, {
          type: 'joined',
          playerId: player.id,
          snapshot: {
            tick: gameState.tick,
            timestamp: Date.now(),
            match: {
              id: gameState.match.id,
              status: gameState.match.status,
              tScore: gameState.match.tScore,
              ctScore: gameState.match.ctScore,
              timeRemaining: gameState.match.timeRemaining,
              mapName: gameState.match.mapData.name,
            },
            players: Array.from(gameState.players.values()).map(toPlayerState),
            bullets: [],
            entities: gameState.entities.map(e => ({ ...e })),
          },
        });

        broadcast({
          type: 'playerJoined',
          player: toPlayerState(player),
        }, ws);
        break;
      }

      case 'input': {
        if (data.playerId) {
          queueInput(gameState, data.playerId, msg.data);
        }
        break;
      }

      case 'pong': {
        // The client echoes our ping timestamp unchanged; measure the round
        // trip into the player's server-side RTT estimate. applyRttSample
        // clamps/ignores bogus samples, so hostile pongs cannot corrupt it.
        if (data.playerId) {
          const player = gameState.players.get(data.playerId);
          if (player) {
            applyRttSample(player, msg.t, Date.now());
          }
        }
        break;
      }

      case 'respawn': {
        if (data.playerId) {
          const player = gameState.players.get(data.playerId);
          if (player && player.isDead) {
            player.respawnTimer = 3000;
          }
        }
        break;
      }

      case 'switchTeam': {
        if (data.playerId) {
          const player = gameState.players.get(data.playerId);
          if (player) {
            player.team = msg.team;
            data.team = msg.team;
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('WebSocket message error:', err);
  }
}

function send(ws: Bun.ServerWebSocket<any>, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage, exclude?: Bun.ServerWebSocket<any>): void {
  const str = JSON.stringify(message);
  for (const [ws] of clients) {
    if (ws !== exclude && ws.readyState === 1) {
      ws.send(str);
    }
  }
}
