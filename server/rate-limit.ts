/** A monotonic-clock token bucket. A long pause cannot accumulate more than one burst. */
export class TokenBucket {
  private tokens: number;
  private previous: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now = performance.now(),
  ) {
    this.tokens = burst;
    this.previous = now;
  }
  take(now = performance.now(), cost = 1): boolean {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.previous) * this.rate) / 1000,
    );
    this.previous = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Snapshots carry full state, so a client whose socket is backlogged skips them instead of
 * being dropped. A welcome's terrain baseline counts as buffered while it compresses; only a
 * backlog that persists marks a stalled client. */
export class SnapshotBacklog {
  private since?: number;
  constructor(
    private readonly limitBytes: number,
    private readonly graceMs: number,
  ) {}
  check(buffered: number, now = performance.now()): 'send' | 'skip' | 'close' {
    if (buffered <= this.limitBytes) {
      this.since = undefined;
      return 'send';
    }
    this.since ??= now;
    return now - this.since > this.graceMs ? 'close' : 'skip';
  }
}
