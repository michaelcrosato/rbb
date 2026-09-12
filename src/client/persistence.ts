import { encodeSave, parseSave } from '../shared/save';
import type { SaveFile } from '../shared/save';
import type { GameState } from '../shared/state';

const KEY = 'rbb.save.v1';
const BACKUP = 'rbb.save.backup.v1';
export interface LoadResult {
  save: SaveFile | null;
  warning?: string;
}

export class SaveStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}
  load(): LoadResult {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return { save: null };
      try {
        return { save: parseSave(raw) };
      } catch {
        const backup = this.storage.getItem(BACKUP);
        if (backup) {
          try {
            return {
              save: parseSave(backup),
              warning: 'Your latest save was damaged. The previous backup was recovered.',
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
  save(state: GameState, playerId: string): string {
    const next = encodeSave(state, playerId);
    parseSave(next);
    const existing = this.storage.getItem(KEY);
    if (existing) {
      try {
        parseSave(existing);
        this.storage.setItem(BACKUP, existing);
      } catch {
        /* Do not replace a healthy backup with corrupt data. */
      }
    }
    this.storage.setItem(KEY, next);
    return next;
  }
  import(text: string): SaveFile {
    const save = parseSave(text);
    this.save(save.state, save.playerId);
    return save;
  }
}
