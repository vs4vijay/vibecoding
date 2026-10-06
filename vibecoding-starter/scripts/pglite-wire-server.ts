/**
 * Serve one PGlite instance over the Postgres wire protocol to many clients.
 *
 * PGlite is a single session. `@electric-sql/pglite-socket` either serves one
 * connection at a time (an idle or LISTENing client blocks everyone) or, with
 * `maxConnections`, queues per protocol message so concurrent clients
 * interleave their Parse/Bind/Execute and get each other's results. This
 * server multiplexes at the right granularity instead: a connection takes the
 * session with its first message and keeps it until the backend reports
 * ReadyForQuery in the idle state, i.e. through a whole extended-query cycle
 * and through a whole transaction. Idle connections hold nothing, so pools and
 * LISTEN connections from several processes coexist, and NOTIFY is relayed to
 * every listening connection.
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
/** A connection that takes the session and then goes silent is evicted. */
const HOLD_TIMEOUT_MS = 30_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function frame(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + body.length);
  out[0] = type.charCodeAt(0);
  new DataView(out.buffer).setUint32(1, 4 + body.length);
  out.set(body, 5);
  return out;
}
const cstr = (...parts: string[]) => encoder.encode(parts.map((part) => `${part}\0`).join(''));
const simpleQuery = (sql: string) => frame('Q', cstr(sql));
const SYNC = frame('S', new Uint8Array(0));

const STARTUP_REPLY = Buffer.concat([
  frame('R', new Uint8Array(4)), // AuthenticationOk
  ...Object.entries({
    server_version: '17.5',
    server_encoding: 'UTF8',
    client_encoding: 'UTF8',
    DateStyle: 'ISO, MDY',
    integer_datetimes: 'on',
    standard_conforming_strings: 'on',
    TimeZone: 'UTC',
  }).map(([name, value]) => frame('S', cstr(name, value))),
  frame('K', new Uint8Array(8)), // BackendKeyData (cancel is not supported)
  frame('Z', encoder.encode('I')),
]);

type Connection = {
  id: number;
  socket: Socket;
  buffer: Buffer;
  started: boolean;
  /** Complete frontend messages waiting for the session. */
  pending: Uint8Array[];
  draining: boolean;
  /** Mid extended-query cycle: messages sent, ReadyForQuery not yet seen. */
  inCycle: boolean;
  /** Last transaction status byte from ReadyForQuery: I, T, or E. */
  txStatus: string;
  listening: boolean;
  closed: boolean;
};

export type WireServerOptions = {
  db: PGlite;
  host: string;
  port: number;
  log?: (message: string) => void;
};

export type WireServer = {
  server: Server;
  /** Close client sockets and stop listening. Does not close the PGlite instance. */
  close: () => Promise<void>;
};

/**
 * Split a backend reply into what goes to the caller and any asynchronous
 * NotificationResponse frames, which belong to every listening connection.
 * Also reports the transaction status of the last ReadyForQuery, if any.
 */
function routeReply(reply: Uint8Array) {
  const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength);
  const direct: Uint8Array[] = [];
  const notifications: Uint8Array[] = [];
  let ready: string | null = null;
  let offset = 0;
  while (offset + 5 <= reply.length) {
    const length = view.getUint32(offset + 1);
    const end = offset + 1 + length;
    if (end > reply.length) break;
    const message = reply.subarray(offset, end);
    const type = String.fromCharCode(reply[offset]);
    if (type === 'A') notifications.push(message);
    else direct.push(message);
    if (type === 'Z') ready = String.fromCharCode(reply[offset + 5]);
    offset = end;
  }
  if (offset < reply.length) direct.push(reply.subarray(offset));
  return { direct, notifications, ready };
}

export function startWireServer(options: WireServerOptions): Promise<WireServer> {
  const { db, host, port } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const connections = new Set<Connection>();
  let nextId = 1;

  // The session lock. `owner` holds PGlite until its exchange completes.
  let owner: Connection | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  const waiters: Array<{ conn: Connection; grant: () => void }> = [];

  function acquire(conn: Connection): Promise<void> {
    if (owner === conn) return Promise.resolve();
    if (owner === null) {
      owner = conn;
      return Promise.resolve();
    }
    return new Promise((grant) => waiters.push({ conn, grant }));
  }

  function release(conn: Connection) {
    if (owner !== conn) return;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    owner = null;
    let next = waiters.shift();
    while (next && next.conn.closed) next = waiters.shift();
    if (next) {
      owner = next.conn;
      next.grant();
    }
  }

  function armHoldTimer(conn: Connection) {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (owner !== conn) return;
      log(`[db] connection ${conn.id} held the session idle for ${HOLD_TIMEOUT_MS / 1000}s; closing it`);
      conn.socket.destroy();
    }, HOLD_TIMEOUT_MS);
  }

  async function drain(conn: Connection) {
    if (conn.draining) return;
    conn.draining = true;
    try {
      while (conn.pending.length > 0 && !conn.closed) {
        await acquire(conn);
        if (conn.closed) break;
        if (holdTimer) clearTimeout(holdTimer);
        const message = conn.pending.shift()!;
        const type = String.fromCharCode(message[0]);
        if (type === 'X') {
          conn.socket.end();
          break;
        }
        // LISTEN arrives as a simple query or as a Parse (statement name, then SQL).
        if ((type === 'Q' || type === 'P') && /(^|\0)\s*listen\s/i.test(decoder.decode(message.subarray(5)))) {
          conn.listening = true;
        }
        conn.inCycle = true;
        const { direct, notifications, ready } = routeReply(await db.execProtocolRaw(message));
        if (ready) {
          conn.inCycle = false;
          conn.txStatus = ready;
        }
        if (!conn.closed) for (const part of direct) conn.socket.write(part);
        for (const notification of notifications) {
          for (const other of connections) {
            if (other.listening && !other.closed) other.socket.write(notification);
          }
        }
        if (!conn.inCycle && conn.txStatus === 'I') release(conn);
        else if (conn.pending.length === 0) armHoldTimer(conn);
      }
    } catch (error) {
      log(`[db] connection ${conn.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      conn.socket.destroy();
    } finally {
      conn.draining = false;
    }
  }

  /** Leave the shared session clean when a connection goes away mid-exchange. */
  async function cleanup(conn: Connection) {
    conn.closed = true;
    connections.delete(conn);
    conn.pending.length = 0;
    if (owner !== conn) return;
    // Wait out any message still executing for this connection.
    while (conn.draining) await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      if (conn.inCycle) await db.execProtocolRaw(SYNC);
      if (conn.inCycle || conn.txStatus !== 'I') await db.execProtocolRaw(simpleQuery('ROLLBACK'));
    } catch (error) {
      log(`[db] rollback after disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    release(conn);
  }

  function onData(conn: Connection, chunk: Buffer) {
    conn.buffer = conn.buffer.length ? Buffer.concat([conn.buffer, chunk]) : chunk;

    while (!conn.started) {
      if (conn.buffer.length < 8) return;
      const length = conn.buffer.readUInt32BE(0);
      if (conn.buffer.length < length) return;
      const code = conn.buffer.readUInt32BE(4);
      conn.buffer = conn.buffer.subarray(length);
      if (code === SSL_REQUEST) {
        conn.socket.write('N'); // no TLS on the loopback dev socket
        continue;
      }
      if (code === CANCEL_REQUEST) {
        conn.socket.end();
        return;
      }
      conn.started = true;
      conn.socket.write(STARTUP_REPLY);
    }

    while (conn.buffer.length >= 5) {
      const end = 1 + conn.buffer.readUInt32BE(1);
      if (conn.buffer.length < end) break;
      conn.pending.push(new Uint8Array(conn.buffer.subarray(0, end)));
      conn.buffer = conn.buffer.subarray(end);
    }
    void drain(conn);
  }

  const server = createServer((socket) => {
    const conn: Connection = {
      id: nextId++,
      socket,
      buffer: Buffer.alloc(0),
      started: false,
      pending: [],
      draining: false,
      inCycle: false,
      txStatus: 'I',
      listening: false,
      closed: false,
    };
    connections.add(conn);
    socket.setNoDelay(true);
    socket.on('data', (chunk) => onData(conn, chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => void cleanup(conn));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        server,
        close: async () => {
          for (const conn of connections) conn.socket.destroy();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
