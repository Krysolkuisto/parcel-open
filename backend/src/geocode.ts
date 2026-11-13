import type { Store } from './store.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Geocoder {
  /** Coordinates of a place name such as "Meyzieu Jonage, France", or null when unknown. */
  locate(place: string): Promise<GeoPoint | null>;
}

export class NoGeocoder implements Geocoder {
  async locate(): Promise<GeoPoint | null> {
    return null;
  }
}

/** Misses are remembered for a week so a bad place name does not trigger a request every time. */
const MISS_TTL_MS = 7 * 24 * 3_600_000;

/**
 * Place name lookup through a Nominatim-compatible service (OpenStreetMap by default).
 * Follows the public usage policy: identifying User-Agent, at most one request per second, results cached.
 * Only place names taken from tracking events are sent, never tracking numbers or user data.
 */
export class NominatimGeocoder implements Geocoder {
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly options: {
      baseUrl: string;
      userAgent: string;
      minIntervalMs?: number;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  async locate(place: string): Promise<GeoPoint | null> {
    const key = place.trim().toLowerCase();
    if (!key) return null;

    const cached = this.store.getGeocode(key);
    if (cached) {
      if (cached.found) return { lat: cached.lat!, lon: cached.lon! };
      if ((this.options.now?.() ?? Date.now()) - Date.parse(cached.createdAt) < MISS_TTL_MS) return null;
    }

    let reachable = true;
    for (const query of queries(place)) {
      const result = await this.lookup(query);
      if (result === 'error') {
        reachable = false;
        break;
      }
      if (result) {
        this.store.putGeocode(key, result);
        return result;
      }
    }
    // Do not remember a miss caused by a network problem.
    if (reachable) this.store.putGeocode(key, null);
    return null;
  }

  /** Requests are serialized and spaced out. */
  private lookup(query: string): Promise<GeoPoint | null | 'error'> {
    const run = async () => {
      const wait = this.lastRequestAt + (this.options.minIntervalMs ?? 1100) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      try {
        const url = new URL('/search', this.options.baseUrl);
        url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' }).toString();
        const res = await (this.options.fetchImpl ?? fetch)(url, {
          headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return 'error' as const;
        const body = (await res.json()) as Array<{ lat?: string; lon?: string }>;
        const first = body[0];
        const lat = Number(first?.lat);
        const lon = Number(first?.lon);
        return first && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      } catch {
        return 'error' as const;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }
}

/**
 * Carrier facility names are often too specific ("Meyzieu Jonage, France"), so try the full text first,
 * then the first word of the town with the country.
 */
export function queries(place: string): string[] {
  const full = place.trim().replace(/\s+/g, ' ');
  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  const out = [full];
  if (parts.length >= 2) {
    const town = parts[0]!;
    const country = parts[parts.length - 1]!;
    const firstWord = town.split(/[\s-]+/)[0]!;
    if (firstWord && firstWord !== town) out.push(`${firstWord}, ${country}`);
  }
  return [...new Set(out)];
}
