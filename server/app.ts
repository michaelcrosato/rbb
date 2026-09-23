import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import pkg from '../package.json' with { type: 'json' };
import { BALANCE } from '../src/shared/content';
import { clientMessageSchema, PROTOCOL_VERSION, snapshotFor } from '../src/shared/protocol';
import type { ServerMessage } from '../src/shared/protocol';
import { Simulation } from '../src/shared/simulation';
import { createState, idleInput } from '../src/shared/state';
import { DEFAULT_SEED, generateWorld } from '../src/shared/world';
import { SnapshotBacklog, TokenBucket } from './rate-limit';
import { WorldStore } from './store';

/** Hard memory bound per socket, above any legitimate message: a welcome carrying the maximum
 * terrain baseline is about 4 MB before compression. */
const MAX_BUFFERED_BYTES = 16_000_000;

export interface ServerOptions {
  allowDevTools?: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
  seed?: string;
  allowedOrigins?: string[];
  saveIntervalMs?: number;
  /** A resume replaces a connection to the same survivor that has been silent this long. */
  staleSessionMs?: number;
  log?: (message: string) => void;
}
interface Client {
  socket: WebSocket;
  playerId?: string;
  lastSeq: number;
  terrainRevision: number;
  lastInput: number;
  lastPong: number;
  /** Any message or heartbeat pong; live tabs answer pings even when hidden. */
  lastSeen: number;
  limiter: TokenBucket;
  actions: TokenBucket;
  backlog: SnapshotBacklog;
  joinedAt: number;
}

export async function startWorldServer(options: ServerOptions = {}) {
  const log = options.log ?? console.log;
  // Longer than the 10 s heartbeat, so a hidden but live tab always answers in time.
  const staleSessionMs = options.staleSessionMs ?? 15_000;
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
  if (saved?.sandbox && !options.allowDevTools) {
    store.close();
    throw new Error(
      'This is a sandbox world. Set ALLOW_DEV_TOOLS=true or use a separate data directory.',
    );
  }
  const sim = new Simulation(world, saved ?? createState(world), options.allowDevTools ?? false);
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
        version: pkg.version,
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
    // Bound pending handshakes separately so a full world can still explain why joining failed.
    if (clients.size >= BALANCE.maxPlayers + 8) {
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
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(1013, 'Client is too slow');
      return;
    }
    socket.send(JSON.stringify(message));
  };
  const snapshot = (client: Client) => {
    const result = snapshotFor(
      sim.state,
      client.playerId!,
      sim.devAllowed,
      client.terrainRevision,
      sim.world,
    );
    client.terrainRevision = sim.state.terrain.revision;
    const active = new Set([...clients.values()].map((c) => c.playerId));
    result.players = result.players.filter((p) => active.has(p.id));
    return result;
  };
  wss.on('connection', (socket: WebSocket) => {
    const now = performance.now();
    const client: Client = {
      socket,
      lastSeq: 0,
      terrainRevision: -1,
      lastInput: now,
      lastPong: now,
      lastSeen: now,
      limiter: new TokenBucket(65, 90),
      actions: new TokenBucket(8, 12),
      backlog: new SnapshotBacklog(512_000, 10_000),
      joinedAt: now,
    };
    clients.set(socket, client);
    socket.on('pong', () => {
      client.lastPong = client.lastSeen = performance.now();
    });
    socket.on('error', () => {
      /* Connection errors are contained by the close handler. */
    });
    socket.on('message', (raw, isBinary) => {
      if (!healthy || shuttingDown) return;
      client.lastSeen = performance.now();
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
          const previous = [...clients.values()].find((c) => c.playerId === playerId);
          // A browser whose network path died resumes before the heartbeat notices. The token
          // proves ownership, so a silent connection yields; a live tab keeps its survivor.
          if (previous && performance.now() - previous.lastSeen < staleSessionMs) {
            send(socket, {
              type: 'error',
              message:
                'This survivor is already connected in another tab. Choose Start a new survivor to play separately.',
            });
            socket.close(1008);
            return;
          }
          if (previous) {
            previous.playerId = undefined;
            previous.socket.terminate();
          }
        }
        if ([...clients.values()].filter((c) => c.playerId).length >= BALANCE.maxPlayers) {
          send(socket, {
            type: 'error',
            message: `World full (${BALANCE.maxPlayers}/${BALANCE.maxPlayers}). Wait for a survivor to leave, then join again.`,
          });
          socket.close(1008, 'World full');
          return;
        }
        if (!playerId) {
          if (Object.keys(sim.state.players).length >= BALANCE.maxSurvivors) {
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
          snapshot: snapshot(client),
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
        if (message.command.type === 'dev' && result.ok)
          send(socket, { type: 'snapshot', snapshot: snapshot(client) });
        if (
          message.command.type !== 'move' &&
          (!result.ok || message.command.type === 'respawn' || message.command.type === 'dev')
        )
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
          for (const client of clients.values()) {
            if (!client.playerId) continue;
            // Decide before building: a skipped snapshot must not advance the terrain revision.
            const pace = client.backlog.check(client.socket.bufferedAmount, now);
            if (pace === 'close') client.socket.close(1013, 'Client is too slow');
            else if (pace === 'send')
              send(client.socket, { type: 'snapshot', snapshot: snapshot(client) });
          }
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
