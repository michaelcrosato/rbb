import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSession } from '../../src/client/session';
import { PROTOCOL_VERSION, snapshotFor } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/simulation';
import { createState, idleInput } from '../../src/shared/state';
import { generateWorld } from '../../src/shared/world';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
const world = generateWorld('remote-tests');
function welcome() {
  const sim = new Simulation(world, createState(world));
  sim.addPlayer('local', 'Tester');
  return {
    type: 'welcome',
    protocol: PROTOCOL_VERSION,
    playerId: 'local',
    token: 'a'.repeat(64),
    snapshot: snapshotFor(sim.state, 'local', false, -1, world),
  };
}
async function connect() {
  const ready = RemoteSession.connect('ws://localhost:8787', 'Tester');
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  socket.receive(welcome());
  return { session: await ready, socket };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('localStorage', memory());
  vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('location', { protocol: 'http:' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('remote session lifecycle', () => {
  it('never replays movement or a jump queued while disconnected', async () => {
    const { session, socket } = await connect();
    socket.close();
    session.command({ type: 'move', input: { ...idleInput(), forward: 1, jump: true } });
    await vi.advanceTimersByTimeAsync(1000);
    const next = FakeSocket.instances.at(-1)!;
    next.open();
    next.receive(welcome());
    session.update(0.1);
    expect(next.sent).toHaveLength(1);
    session.close();
  });
  it('times out a missing welcome without leaving reconnect work behind', async () => {
    const ready = RemoteSession.connect('ws://localhost:8787', 'Tester');
    const rejected = expect(ready).rejects.toThrow('did not respond');
    FakeSocket.instances[0].open();
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(FakeSocket.instances[0].readyState).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off retries, bounds attempts, and cancels pending work on close', async () => {
    const { session, socket } = await connect();
    socket.close();
    for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
      const count = FakeSocket.instances.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeSocket.instances).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.instances).toHaveLength(count + 1);
      FakeSocket.instances.at(-1)!.close();
    }
    expect(session.status).toContain('Connection lost');
    expect(vi.getTimerCount()).toBe(0);
    session.close();

    const other = await connect();
    other.socket.close();
    other.session.close();
    const count = FakeSocket.instances.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(FakeSocket.instances).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes identity with a fresh sequence, ignores stale sockets and discards offline movement', async () => {
    const { session, socket } = await connect();
    session.command({ type: 'move', input: { ...idleInput(), forward: 1, jump: true } });
    socket.close();
    session.command({ type: 'move', input: { ...idleInput(), forward: 1, jump: true } });
    await vi.advanceTimersByTimeAsync(1000);
    const next = FakeSocket.instances.at(-1)!;
    next.open();
    expect(next.sent[0]).toMatchObject({ type: 'hello', token: 'a'.repeat(64) });
    next.receive(welcome());
    socket.receive({ type: 'error', message: 'stale error' });
    socket.close();
    session.update(0.1);
    expect(next.sent).toHaveLength(1);
    expect(session.status).toContain('Connected');
    session.command({ type: 'move', input: { ...idleInput(), yaw: 1 } });
    session.command({ type: 'attack' });
    expect(next.sent.slice(1)).toMatchObject([
      {
        type: 'command',
        seq: 1,
        command: { type: 'move', input: { yaw: 1, forward: 0, jump: false } },
      },
      { type: 'command', seq: 2, command: { type: 'attack' } },
    ]);
    session.close();
    next.receive(welcome());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains malformed results, events, pongs and changed identities without callbacks', async () => {
    for (const invalid of [
      { type: 'result', seq: 1, result: { ok: 'yes', message: 'bad' } },
      { type: 'events', events: [null] },
      { type: 'events', events: [{ type: 'damage', playerId: 'local', message: 'bad', x: 'bad' }] },
      { type: 'pong', at: 'bad' },
      { type: 'unknown' },
      {
        type: 'snapshot',
        snapshot: { ...welcome().snapshot, self: { ...welcome().snapshot.self, id: 'other' } },
      },
    ]) {
      const { session, socket } = await connect();
      session.onResult = vi.fn();
      session.onEvents = vi.fn();
      const before = JSON.stringify(session.state);
      socket.receive(invalid);
      expect(session.status).toBe('Incompatible server data');
      expect(session.onResult).not.toHaveBeenCalled();
      expect(session.onEvents).not.toHaveBeenCalled();
      expect(JSON.stringify(session.state)).toBe(before);
      expect(socket.readyState).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('rejects pre-welcome data and duplicate welcomes', async () => {
    const pending = RemoteSession.connect('ws://localhost:8787', 'Tester');
    const rejected = expect(pending).rejects.toThrow('incompatible');
    FakeSocket.instances[0].receive({ type: 'snapshot', snapshot: welcome().snapshot });
    await rejected;
    const { session, socket } = await connect();
    socket.receive(welcome());
    expect(session.status).toBe('Incompatible server data');
  });

  it('detects stalled connections and retains a server rejoin error without retrying', async () => {
    const { session, socket } = await connect();
    await vi.advanceTimersByTimeAsync(12001);
    session.update(3.1);
    expect(socket.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    const next = FakeSocket.instances.at(-1)!;
    next.open();
    next.receive({ type: 'error', message: 'World full (4/4).' });
    expect(session.status).toBe('World full (4/4).');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses tab credentials even when local storage is unavailable', async () => {
    const { session, socket } = await connect();
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    session.onResult = vi.fn();
    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const next = FakeSocket.instances.at(-1)!;
    next.open();
    next.receive(welcome());
    expect(session.onResult).not.toHaveBeenCalled();
    session.close();
  });
});
