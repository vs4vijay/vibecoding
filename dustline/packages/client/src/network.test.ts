import { describe, it, expect } from 'bun:test';

type Handler = (ev: { data: string }) => void;

/** Minimal WebSocket double: records sends, lets tests deliver server messages. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: Handler | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  private listeners = new Map<string, Handler[]>();

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Handler): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn));
  }

  close(): void {}

  /** Test helper: deliver a server message through both dispatch paths. */
  receive(payload: unknown): void {
    const ev = { data: JSON.stringify(payload) };
    for (const fn of this.listeners.get('message') ?? []) fn(ev);
    this.onmessage?.(ev);
  }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
(globalThis as unknown as { location: unknown }).location = { protocol: 'http:', host: 'test' };

describe('client pong reply', () => {
  it('replies to server pings with an echoing pong and ignores unknown messages', async () => {
    const realLog = console.log;
    console.log = () => {}; // silence network.ts connection logs
    try {
      const network = await import('./network.js');
      const connected = network.connect('Tester', 'T');
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

      ws.onopen?.();
      ws.receive({ type: 'joined', playerId: 'p_1' }); // complete the join handshake
      await connected;

      ws.receive({ type: 'ping', t: 12345 });
      const pongs = ws.sent.map(data => JSON.parse(data)).filter(msg => msg.type === 'pong');
      expect(pongs).toEqual([{ type: 'pong', t: 12345 }]);

      const sentBefore = ws.sent.length;
      expect(() => ws.receive({ type: 'mysterious' })).not.toThrow();
      expect(ws.sent.length).toBe(sentBefore);

      network.disconnect();
    } finally {
      console.log = realLog;
    }
  });
});
