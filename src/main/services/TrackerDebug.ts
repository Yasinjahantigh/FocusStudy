import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface TrackerDebugEntry {
  ts: number;
  pid?: number;
  appName: string;
  title: string;
  domain?: string;
  category: string;
  confidence: number;
  source: string;
  needsReview: boolean;
  isChange: boolean;
  event?: string;
}

const MAX_ENTRIES = 40;

/** In-memory ring buffer with a debounced write to userData/tracker-debug.json. */
class TrackerDebug {
  private entries: TrackerDebugEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'tracker-debug.json');
  }

  public record(entry: TrackerDebugEntry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.persist();
      }, 800);
    }
  }

  public snapshot(): { entries: TrackerDebugEntry[]; filePath: string } {
    return { entries: [...this.entries], filePath: this.filePath };
  }

  public persist() {
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ entries: this.entries, writtenAt: Date.now() }), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.warn('[TrackerDebug] Failed to persist:', err);
    }
  }
}

export const trackerDebug = new TrackerDebug();