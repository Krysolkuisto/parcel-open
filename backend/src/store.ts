import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { PackageStatus, TrackingEvent } from './domain.js';

export interface PackageRow {
  id: string;
  tracking_number: string;
  label: string | null;
  description: string | null;
  carrier_code: string | null;
  carrier_name: string | null;
  postal_code: string | null;
  provider: string;
  provider_ref: string | null;
  status: PackageStatus;
  status_text: string | null;
  eta: string | null;
  origin: string | null;
  destination: string | null;
  delivered_at: string | null;
  archived: number;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type PackagePatch = Partial<Omit<PackageRow, 'id' | 'tracking_number' | 'created_at'>>;

const PATCHABLE = new Set([
  'label', 'description', 'carrier_code', 'carrier_name', 'postal_code', 'provider', 'provider_ref',
  'status', 'status_text', 'eta', 'origin', 'destination', 'delivered_at', 'archived',
  'last_checked_at', 'last_error', 'updated_at',
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL UNIQUE,
  label TEXT,
  description TEXT,
  carrier_code TEXT,
  carrier_name TEXT,
  postal_code TEXT,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  status_text TEXT,
  eta TEXT,
  origin TEXT,
  destination TEXT,
  delivered_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  status TEXT,
  UNIQUE (package_id, time, description)
);
CREATE INDEX IF NOT EXISTS idx_events_package_time ON events(package_id, time DESC);
CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  found INTEGER NOT NULL,
  lat REAL,
  lon REAL,
  created_at TEXT NOT NULL
);
`;

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  insert(input: {
    trackingNumber: string;
    label: string | null;
    description: string | null;
    carrierCode: string | null;
    postalCode: string | null;
    provider: string;
  }): PackageRow {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO packages (id, tracking_number, label, description, carrier_code, postal_code, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.trackingNumber, input.label, input.description, input.carrierCode, input.postalCode, input.provider, now, now);
    return this.get(id)!;
  }

  get(id: string): PackageRow | undefined {
    return this.db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as unknown as PackageRow | undefined;
  }

  getByNumber(trackingNumber: string): PackageRow | undefined {
    return this.db.prepare('SELECT * FROM packages WHERE tracking_number = ?').get(trackingNumber) as unknown as
      | PackageRow
      | undefined;
  }

  list(includeArchived: boolean): PackageRow[] {
    const sql = includeArchived
      ? 'SELECT * FROM packages ORDER BY created_at DESC'
      : 'SELECT * FROM packages WHERE archived = 0 ORDER BY created_at DESC';
    return this.db.prepare(sql).all() as unknown as PackageRow[];
  }

  update(id: string, patch: PackagePatch): PackageRow | undefined {
    const entries = Object.entries(patch).filter(([k, v]) => PATCHABLE.has(k) && v !== undefined);
    if (entries.length === 0) return this.get(id);
    const set = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v as SQLInputValue);
    this.db.prepare(`UPDATE packages SET ${set} WHERE id = ?`).run(...values, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM packages WHERE id = ?').run(id).changes) > 0;
  }

  /** Inserts events that are not already stored. Returns how many were new. */
  saveEvents(packageId: string, events: TrackingEvent[]): number {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO events (package_id, time, description, location, status) VALUES (?, ?, ?, ?, ?)',
    );
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const e of events) {
        added += Number(stmt.run(packageId, e.time, e.description, e.location, e.status).changes);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  events(packageId: string, limit = 200): TrackingEvent[] {
    return this.db
      .prepare('SELECT time, description, location, status FROM events WHERE package_id = ? ORDER BY time DESC, id DESC LIMIT ?')
      .all(packageId, limit) as unknown as TrackingEvent[];
  }

  getGeocode(query: string): { found: boolean; lat: number | null; lon: number | null; createdAt: string } | undefined {
    const row = this.db
      .prepare('SELECT found, lat, lon, created_at FROM geocode_cache WHERE query = ?')
      .get(query) as unknown as { found: number; lat: number | null; lon: number | null; created_at: string } | undefined;
    return row && { found: row.found === 1, lat: row.lat, lon: row.lon, createdAt: row.created_at };
  }

  putGeocode(query: string, point: { lat: number; lon: number } | null): void {
    this.db
      .prepare('INSERT OR REPLACE INTO geocode_cache (query, found, lat, lon, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(query, point ? 1 : 0, point?.lat ?? null, point?.lon ?? null, new Date().toISOString());
  }

  latestEvent(packageId: string): TrackingEvent | null {
    return this.events(packageId, 1)[0] ?? null;
  }
}
