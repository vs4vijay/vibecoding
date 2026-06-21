import type { ClientMessage, ServerMessage, GameSnapshot, InputState, Team, PlayerState } from '@cs-clone/shared';

let ws: WebSocket | null = null;
let connected = false;
let playerId: string | null = null;
let reconnectTimer: number | null = null;

const onSnapshot = (snapshot: GameSnapshot) => {};
const onPlayerJoined = (player: PlayerState) => {};
const onPlayerLeft = (playerId: string) => {};
const onKill = (killerId: string, victimId: string, weapon: string) => {};
const onDeath = (killerId: string, weapon: string) => {};
const onMatchStart = (matchId: string) => {};
const onMatchEnd = (tScore: number, ctScore: number, winner: Team) => {};
const onError = (message: string) => {};

export function setCallbacks(callbacks: {
  onSnapshot: (snapshot: GameSnapshot) => void;
  onPlayerJoined: (player: PlayerState) => void;
  onPlayerLeft: (playerId: string) => void;
  onKill: (killerId: string, victimId: string, weapon: string) => void;
  onDeath: (killerId: string, weapon: string) => void;
  onMatchStart: (matchId: string) => void;
  onMatchEnd: (tScore: number, ctScore: number, winner: Team) => void;
  onError: (message: string) => void;
}): void {
  Object.assign(onSnapshot, callbacks);
}

// Override the placeholder functions
let cb: {
  onSnapshot: (snapshot: GameSnapshot) => void;
  onPlayerJoined: (player: PlayerState) => void;
  onPlayerLeft: (playerId: string) => void;
  onKill: (killerId: string, victimId: string, weapon: string) => void;
  onDeath: (killerId: string, weapon: string) => void;
  onMatchStart: (matchId: string) => void;
  onMatchEnd: (tScore: number, ctScore: number, winner: Team) => void;
  onError: (message: string) => void;
} | null = null;

export function setCallbacks2(callbacks: typeof cb): void {
  cb = callbacks;
}

export function connect(username: string, team: Team): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    console.log('🔌 Connecting to:', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      connected = true;

      // Send join message
      send({ type: 'join', username, team });

      const currentWs = ws!;

      // Wait for joined response
      const handler = (event: MessageEvent) => {
        const msg: ServerMessage = JSON.parse(event.data);
        if (msg.type === 'joined') {
          playerId = msg.playerId;
          currentWs.removeEventListener('message', handler);
          currentWs.onmessage = handleServerMessage;
          console.log('🎮 Joined as:', playerId);
          resolve(msg.playerId);
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      };
      currentWs.addEventListener('message', handler);
    };

    ws.onclose = () => {
      connected = false;
      console.log('🔌 WebSocket disconnected');
      // Reconnect after 1s
      reconnectTimer = window.setTimeout(() => {
        if (playerId) {
          console.log('🔄 Reconnecting...');
          connect(username, team);
        }
      }, 1000);
    };

    ws.onerror = (err) => {
      console.error('❌ WebSocket error:', err);
    };
  });
}

function handleServerMessage(event: MessageEvent): void {
  try {
    const msg: ServerMessage = JSON.parse(event.data);

    switch (msg.type) {
      case 'snapshot':
        cb?.onSnapshot(msg.snapshot);
        break;
      case 'playerJoined':
        cb?.onPlayerJoined(msg.player);
        break;
      case 'playerLeft':
        cb?.onPlayerLeft(msg.playerId);
        break;
      case 'kill':
        cb?.onKill(msg.killerId, msg.victimId, msg.weaponName);
        break;
      case 'death':
        cb?.onDeath(msg.killerId, msg.weaponName);
        break;
      case 'matchStart':
        cb?.onMatchStart(msg.matchId);
        break;
      case 'matchEnd':
        cb?.onMatchEnd(msg.tScore, msg.ctScore, msg.winner);
        break;
      case 'error':
        cb?.onError(msg.message);
        break;
    }
  } catch (err) {
    console.error('Message parse error:', err);
  }
}

export function send(message: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function sendInput(input: InputState): void {
  send({ type: 'input', data: input });
}

export function sendRespawn(): void {
  send({ type: 'respawn' });
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  connected = false;
  playerId = null;
}

export function getPlayerId(): string | null {
  return playerId;
}

export function isConnected(): boolean {
  return connected;
}
