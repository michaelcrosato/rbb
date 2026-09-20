import { encodeSave, parseSave } from '../shared/save';
import type { SaveFile } from '../shared/save';
import type { GameState } from '../shared/state';

const KEY = 'rbb.save.v1';
const BACKUP = 'rbb.save.backup.v1';
export class SaveConflictError extends Error {
  constructor() {
    super(
      'Another tab changed this expedition. Saving stopped; export your progress or return to the menu to load the latest save.',
    );
  }
}
export interface LoadResult {
  save: SaveFile | null;
  warning?: string;
}

export class SaveStore {
  /** The last file this store wrote; it was validated then and need not be parsed again. */
  private lastWritten: string | null = null;
  private observed: string | null | undefined;
  private releaseLock?: () => void;
  private acquiring?: Promise<void>;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  /** Hold exclusive ownership while solo is active. Non-secure origins also use
   * the stale-write check below, but cannot make cross-tab writes atomic. */
  acquire(locks?: Pick<LockManager, 'request'>): Promise<void> {
    if (this.releaseLock || !locks) return Promise.resolve();
    if (this.acquiring) return this.acquiring;
    this.acquiring = new Promise<void>((resolve, reject) => {
      void locks
        .request(KEY, { ifAvailable: true }, (lock) => {
          if (!lock) {
            reject(
              new Error(
                'This solo expedition is open in another tab. Return that tab to the main menu or close it, then try again.',
              ),
            );
            return;
          }
          return new Promise<void>((release) => {
            this.releaseLock = release;
            resolve();
          });
        })
        .catch(reject);
    }).finally(() => {
      this.acquiring = undefined;
    });
    return this.acquiring;
  }
  release(): void {
    this.releaseLock?.();
    this.releaseLock = undefined;
  }
  load(): LoadResult {
    try {
      const raw = this.storage.getItem(KEY);
      this.observed = raw;
      const backup = this.storage.getItem(BACKUP);
      if (!raw && !backup) return { save: null };
      try {
        if (raw) return { save: parseSave(raw) };
        throw new Error('Missing latest save');
      } catch {
        if (backup) {
          try {
            return {
              save: parseSave(backup),
              warning:
                'Your latest save was missing or damaged. The previous backup was recovered.',
            };
          } catch {
            /* Preserve both files for manual recovery. */
          }
        }
        return {
          save: null,
          warning:
            'Your save could not be read. Import a backup or deliberately start a new expedition.',
        };
      }
    } catch {
      return {
        save: null,
        warning: 'Browser storage is unavailable. Export your save before leaving.',
      };
    }
  }
  save(state: GameState, playerId: string): SaveFile {
    const next = encodeSave(state, playerId);
    const file = parseSave(next);
    const existing = this.storage.getItem(KEY);
    if (this.observed !== undefined && existing !== this.observed) throw new SaveConflictError();
    if (existing) {
      try {
        if (existing !== this.lastWritten) parseSave(existing);
        this.storage.setItem(BACKUP, existing);
      } catch {
        /* Do not replace a healthy backup with corrupt data. */
      }
    }
    this.storage.setItem(KEY, next);
    this.observed = next;
    this.lastWritten = next;
    return file;
  }
  import(text: string): SaveFile {
    const save = parseSave(text);
    this.save(save.state, save.playerId);
    return save;
  }
}
