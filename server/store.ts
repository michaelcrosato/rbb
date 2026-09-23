import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseState } from '../src/shared/save';
import type { GameState } from '../src/shared/state';

const checksum = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashToken = (value: string): string => checksum(value);

/** One world per SQLite database. WAL + atomic snapshots + last-known-good recovery. */
export class WorldStore {
  readonly db: DatabaseSync;
  recovered = false;
  private initialized: boolean;
  /** This process loaded or wrote the `current` row and validated it then. Re-parsing a large
   * edited world on every save would double the main-thread stall; the checksum still guards it. */
  private currentValid = false;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version > 1) {
      this.db.close();
      throw new Error(
        'This database uses a newer schema. Upgrade the server; the database was not changed.',
      );
    }
    this.initialized = version > 0;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshots (slot TEXT PRIMARY KEY, body TEXT NOT NULL, checksum TEXT NOT NULL, saved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);`);
  }
  load(): GameState | null {
    const current = this.db
      .prepare('SELECT body, checksum FROM snapshots WHERE slot = ?')
      .get('current') as { body: string; checksum: string } | undefined;
    const backup = this.db
      .prepare('SELECT body, checksum FROM snapshots WHERE slot = ?')
      .get('backup') as { body: string; checksum: string } | undefined;
    this.currentValid = false;
    if (!current && !backup && !this.initialized) return null;
    const parse = (row: { body: string; checksum: string }) => {
      if (checksum(row.body) !== row.checksum) throw new Error('Snapshot checksum mismatch');
      return parseState(JSON.parse(row.body));
    };
    if (current) {
      try {
        const state = parse(current);
        this.currentValid = true;
        return state;
      } catch {}
    }
    if (backup) {
      try {
        const state = parse(backup);
        this.recovered = true;
        return state;
      } catch {}
    }
    throw new Error(
      'World snapshots failed validation. Restore a database backup before starting; no world was overwritten.',
    );
  }
  save(state: GameState): void {
    const body = JSON.stringify(state);
    parseState(JSON.parse(body));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db
        .prepare('SELECT body, checksum FROM snapshots WHERE slot = ?')
        .get('current') as { body: string; checksum: string } | undefined;
      if (current && checksum(current.body) === current.checksum) {
        try {
          if (!this.currentValid) parseState(JSON.parse(current.body));
          this.db.exec(
            "INSERT OR REPLACE INTO snapshots SELECT 'backup', body, checksum, saved_at FROM snapshots WHERE slot = 'current'",
          );
        } catch {}
      }
      this.db
        .prepare(
          'INSERT OR REPLACE INTO snapshots (slot, body, checksum, saved_at) VALUES (?, ?, ?, ?)',
        )
        .run('current', body, checksum(body), new Date().toISOString());
      // Mark the database as a world only with its first snapshot. Stamping it on open made a
      // first boot interrupted before saving look like a damaged world on every later start.
      if (!this.initialized) this.db.exec('PRAGMA user_version=1');
      this.db.exec('COMMIT');
      this.initialized = true;
      this.currentValid = true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  findPlayer(token: string): string | undefined {
    return (
      this.db
        .prepare('SELECT player_id FROM identities WHERE token_hash = ?')
        .get(hashToken(token)) as { player_id: string } | undefined
    )?.player_id;
  }
  register(token: string, playerId: string): void {
    this.db
      .prepare('INSERT INTO identities (token_hash, player_id, created_at) VALUES (?, ?, ?)')
      .run(hashToken(token), playerId, new Date().toISOString());
  }
  close(): void {
    this.db.close();
  }
}
