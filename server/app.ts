import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { BALANCE } from '../src/shared/content';
import { clientMessageSchema, PROTOCOL_VERSION, snapshotFor } from '../src/shared/protocol';
import type { ServerMessage } from '../src/shared/protocol';
import { Simulation } from '../src/shared/simulation';
import { createState, idleInput } from '../src/shared/state';
import { DEFAULT_SEED, generateWorld } from '../src/shared/world';
import { TokenBucket } from './rate-limit';
import { WorldStore } from './store';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  seed?: string;
  allowedOrigins?: string[];
  saveIntervalMs?: number;
  log?: (message: string) => void;
}
interface Client {
  socket: WebSocket;
  playerId?: string;
  lastSeq: number;
  lastInput: number;
  lastPong: number;
  limiter: TokenBucket;
  actions: TokenBucket;
  joinedAt: number;
}

export async function startWorldServer(options: ServerOptions = {}) {
  const log = options.log ?? console.log;
  const store = new WorldStore(join(options.dataDir ?? './data', 'world.db'));
  let saved;
  try {
    saved = store.load();
  } catch (error) {
    store.close();
    throw error;
  }
  if (saved && options.seed && options.seed !== saved.seed) {
    store.close();
    throw new Error(
      'Configured seed does not match the stored world. Use a new data directory for a new world.',
    );
  }
  const world = generateWorld(saved?.seed ?? options.seed ?? DEFAULT_SEED);
  const sim = new Simulation(world, saved ?? createState(world));
  const allowed = new Set(
    options.allowedOrigins ?? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4175',
      'http://127.0.0.1:4175',
    ],
  );
  const clients = new Map<WebSocket, Client>();
  const addresses = new Map<string, { limiter: TokenBucket; lastSeen: number }>();
  let healthy = true,
    shuttingDown = false,
    lastSave = 0,
    rejectedMessages = 0;
  const started = performance.now();
  const persist = () => {
    try {
      store.save(sim.state);
      lastSave = Date.now();
    } catch {
      healthy = false;
      log('Persistence failed. World simulation paused to protect progress.');
      for (const ws of clients.keys()) ws.close(1011, 'World storage unavailable');
    }
  };
  persist();
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(healthy && !shuttingDown ? 200 : 503);
    res.end(
      JSON.stringify({
        service: 'rbb-world',
        version: '0.1.0',
        protocol: PROTOCOL_VERSION,
        ready: healthy && !shuttingDown,
        tick: sim.state.tick,
        players: [...clients.values()].filter((c) => c.playerId).length,
        capacity: BALANCE.maxPlayers,
        uptimeSeconds: Math.floor((performance.now() - started) / 1000),
        lastSave,
        rejectedMessages,
      }),
    );
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 2,
    },
  });
  server.on('upgrade', (req, socket, head) => {
    const reject = (code: number) => {
      socket.write(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!healthy || shuttingDown) {
      reject(503);
      return;
    }
    if (req.url !== '/' && req.url !== '/world') {
      reject(404);
      return;
    }
    // Native test/bot clients can omit Origin. Browser origins must match exactly; no wildcard defaults.
    if (req.headers.origin && !allowed.has(req.headers.origin)) {
      reject(403);
      return;
    }
    if (clients.size >= BALANCE.maxPlayers) {
      reject(503);
      return;
    }
    const address = req.socket.remoteAddress ?? 'unknown';
    let entry = addresses.get(address);
    if (!entry) {
      if (addresses.size >= 2048) {
        reject(429);
        return;
      }
      entry = { limiter: new TokenBucket(0.5, 24), lastSeen: performance.now() };
      addresses.set(address, entry);
    }
    entry.lastSeen = performance.now();
    if (!entry.limiter.take()) {
      reject(429);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 512_000) {
      socket.close(1013, 'Client is too slow');
      return;
    }
    socket.send(JSON.stringify(message));
  };
  const snapshot = (id: string) => {
    const result = snapshotFor(sim.state, id);
    const active = new Set([...clients.values()].map((c) => c.playerId));
    result.players = result.players.filter((p) => active.has(p.id));
    return result;
  };
  wss.on('connection', (socket: WebSocket) => {
    const now = performance.now();
    const client: Client = {
      socket,
      lastSeq: 0,
      lastInput: now,
      lastPong: now,
      limiter: new TokenBucket(65, 90),
      actions: new TokenBucket(8, 12),
      joinedAt: now,
    };
    clients.set(socket, client);
    socket.on('pong', () => {
      client.lastPong = performance.now();
    });
    socket.on('error', () => {
      /* Connection errors are contained by the close handler. */
    });
    socket.on('message', (raw, isBinary) => {
      if (!healthy || shuttingDown) return;
      if (isBinary || !client.limiter.take()) {
        rejectedMessages++;
        socket.close(1008, 'Message limit exceeded');
        return;
      }
      let parsed;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        rejectedMessages++;
        socket.close(1008, 'Invalid JSON');
        return;
      }
      if (!parsed.success) {
        rejectedMessages++;
        socket.close(1008, 'Invalid protocol message');
        return;
      }
      const message = parsed.data;
      if (message.type === 'hello') {
        if (client.playerId) {
          socket.close(1008, 'Already joined');
          return;
        }
        let token = message.token,
          playerId: string | undefined;
        if (token) {
          playerId = store.findPlayer(token);
          if (!playerId || !sim.state.players[playerId]) {
            send(socket, {
              type: 'error',
              message: 'This survivor session is no longer valid on this server.',
            });
            socket.close(1008);
            return;
          }
          if ([...clients.values()].some((c) => c.playerId === playerId)) {
            send(socket, {
              type: 'error',
              message: 'This survivor is already connected in another tab.',
            });
            socket.close(1008);
            return;
          }
        } else {
          if (Object.keys(sim.state.players).length >= 512) {
            send(socket, {
              type: 'error',
              message: 'This alpha world has reached its survivor registry limit.',
            });
            socket.close(1013);
            return;
          }
          token = randomBytes(32).toString('hex');
          playerId = `p${randomUUID().replaceAll('-', '')}`;
          sim.addPlayer(playerId, message.name);
          try {
            persist();
            if (!healthy) return;
            store.register(token, playerId);
          } catch {
            send(socket, { type: 'error', message: 'Could not persist this survivor.' });
            socket.close(1011);
            return;
          }
        }
        client.playerId = playerId;
        client.lastInput = performance.now();
        sim.state.players[playerId].input = idleInput();
        send(socket, {
          type: 'welcome',
          protocol: PROTOCOL_VERSION,
          playerId,
          token: token!,
          snapshot: snapshot(playerId),
        });
      } else if (message.type === 'ping') send(socket, { type: 'pong', at: message.at });
      else if (message.type === 'command') {
        if (!client.playerId) {
          socket.close(1008, 'Join before sending commands');
          return;
        }
        if (message.seq <= client.lastSeq) {
          rejectedMessages++;
          send(socket, {
            type: 'result',
            seq: message.seq,
            result: { ok: false, message: 'Duplicate or stale command ignored.' },
          });
          return;
        }
        client.lastSeq = message.seq;
        if (message.command.type !== 'move' && !client.actions.take()) {
          rejectedMessages++;
          send(socket, {
            type: 'result',
            seq: message.seq,
            result: { ok: false, message: 'Too many actions. Slow down.' },
          });
          return;
        }
        if (message.command.type === 'move') client.lastInput = performance.now();
        const result = sim.command(client.playerId, message.command);
        if (message.command.type !== 'move' && (!result.ok || message.command.type === 'respawn'))
          send(socket, { type: 'result', seq: message.seq, result });
      }
    });
    socket.on('close', () => {
      clients.delete(socket);
      if (client.playerId) {
        sim.state.players[client.playerId].input = idleInput();
        if (!shuttingDown && healthy) persist();
      }
    });
  });

  let previous = performance.now(),
    accumulator = 0,
    sinceSave = 0,
    sinceHeartbeat = 0;
  const interval = setInterval(() => {
    if (!healthy || shuttingDown) return;
    const now = performance.now(),
      dt = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    const active = new Set<string>();
    for (const client of clients.values()) {
      if (!client.playerId) {
        if (now - client.joinedAt > 5000) client.socket.close(1008, 'Handshake timeout');
        continue;
      }
      active.add(client.playerId);
      if (now - client.lastInput > 300) {
        const p = sim.state.players[client.playerId];
        p.input = { ...idleInput(), yaw: p.yaw, pitch: p.pitch };
      }
    }
    // Empty worlds pause. Offline survivors are retained on disk and never simulated.
    if (active.size) {
      accumulator += dt;
      while (accumulator >= 1 / BALANCE.tickRate) {
        sim.tick(1 / BALANCE.tickRate, active);
        accumulator -= 1 / BALANCE.tickRate;
        if (sim.state.tick % 3 === 0)
          for (const client of clients.values())
            if (client.playerId)
              send(client.socket, { type: 'snapshot', snapshot: snapshot(client.playerId) });
      }
      const events = sim.drainEvents();
      for (const client of clients.values())
        if (client.playerId) {
          const own = events.filter((e) => e.playerId === client.playerId);
          if (own.length) send(client.socket, { type: 'events', events: own });
        }
      sinceSave += dt * 1000;
      if (sinceSave >= (options.saveIntervalMs ?? 5000)) {
        persist();
        sinceSave = 0;
      }
    } else accumulator = 0;
    sinceHeartbeat += dt;
    if (sinceHeartbeat > 10) {
      sinceHeartbeat = 0;
      for (const client of clients.values()) {
        if (now - client.lastPong > 25000) client.socket.terminate();
        else client.socket.ping();
      }
      for (const [ip, entry] of addresses) if (now - entry.lastSeen > 120000) addresses.delete(ip);
    }
  }, 1000 / BALANCE.tickRate);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(interval);
    store.close();
    wss.close();
    throw error;
  }
  const address = server.address() as AddressInfo;
  log(
    `RBB world ready on port ${address.port}. Protocol ${PROTOCOL_VERSION}.${store.recovered ? ' Recovered the previous valid snapshot.' : ''}`,
  );
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closePromise ??= (async () => {
      shuttingDown = true;
      clearInterval(interval);
      persist();
      for (const socket of clients.keys()) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    })());
  return {
    server,
    port: address.port,
    close,
    diagnostics: () => ({
      tick: sim.state.tick,
      connections: clients.size,
      players: Object.keys(sim.state.players).length,
      healthy,
      lastSave,
      rejectedMessages,
    }),
  };
}
