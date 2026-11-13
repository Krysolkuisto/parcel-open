import { randomUUID } from 'node:crypto';
import { detectCarrier } from '../carriers.js';
import {
  ProviderError,
  type PackageStatus,
  type TrackInput,
  type TrackingEvent,
  type TrackingProvider,
  type TrackingResult,
} from '../domain.js';
import { arr, joinParts, obj, requestJson, str, toIso, type FetchLike, type Json } from './http.js';

/**
 * UPS Tracking API (free with a UPS developer app): https://developer.ups.com
 * OAuth 2 client credentials, then GET /api/track/v1/details/{number}.
 * Request and response shapes follow UPS's official OpenAPI files (github.com/UPS-API/api-documentation).
 */
const BASE_URL = 'https://onlinetools.ups.com';

export class UpsProvider implements TrackingProvider {
  readonly name = 'ups';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  acceptsCarrier(): boolean {
    return false;
  }

  /** UPS "1Z" small-package numbers. */
  canTrack(trackingNumber: string): boolean {
    return detectCarrier(trackingNumber)?.code === 'ups';
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    return this.refresh(input);
  }

  async refresh(input: TrackInput): Promise<TrackingResult> {
    if (!this.canTrack(input.trackingNumber)) {
      throw new ProviderError('This does not look like a UPS tracking number', false);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { status, body } = await requestJson(
        this.fetchImpl,
        `${BASE_URL}/api/track/v1/details/${encodeURIComponent(input.trackingNumber)}?locale=en_US`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${await this.accessToken()}`,
            transId: randomUUID(),
            transactionSrc: 'parcel-open',
          },
        },
      );
      if (status === 401 && attempt === 0) {
        this.token = null; // expired or revoked: fetch a new one and retry once
        continue;
      }
      return this.interpret(status, obj(body));
    }
    throw new ProviderError('UPS rejected the credentials', false, 401);
  }

  private interpret(status: number, body: Json): TrackingResult {
    if (status === 401 || status === 403) throw new ProviderError('UPS rejected the credentials', false, status);
    if (status === 404) return emptyResult();
    if (status >= 400) {
      const first = obj(arr(obj(body.response).errors)[0]);
      throw new ProviderError(str(first.message) ?? `UPS error (HTTP ${status})`, false, status);
    }
    const shipment = obj(arr(obj(body.trackResponse).shipment)[0]);
    const pkg = arr(shipment.package)[0];
    // A known-format number UPS has not scanned yet comes back with a warning and no package.
    return pkg ? parsePackage(pkg) : emptyResult();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;

    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE_URL}/security/v1/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-merchant-id': this.clientId,
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(`Network error: ${(err as Error).message}`, true);
    }
    if (res.status === 401 || res.status === 400) {
      throw new ProviderError('UPS rejected the client id or secret', false, res.status);
    }
    if (!res.ok) throw new ProviderError(`UPS sign-in failed (HTTP ${res.status})`, res.status >= 500 || res.status === 429, res.status);

    const data = obj(await res.json().catch(() => null));
    const value = str(data.access_token);
    if (!value) throw new ProviderError('UPS sign-in returned no access token', false);
    const lifetimeSeconds = Number(data.expires_in) || 3600;
    this.token = { value, expiresAt: this.now() + Math.max(60, lifetimeSeconds - 120) * 1000 };
    return value;
  }
}

function emptyResult(): TrackingResult {
  return {
    status: 'unknown',
    statusText: null,
    carrierCode: 'ups',
    carrierName: 'UPS',
    eta: null,
    origin: null,
    destination: null,
    events: [],
    providerRef: null,
  };
}

const OUT_FOR_DELIVERY = /out for delivery/i;
const PICKUP_POINT = /ready for (customer )?(pick ?up|collection)|ups access point|will be held|held at/i;
const FAILED = /attempt|not available|no one|nobody|closed|unable to deliver|could not be delivered/i;

/**
 * UPS activity status types: M manifest (label created), P pickup, I in transit, O out for delivery,
 * D delivered, X exception, RS returned to shipper, W warehousing.
 */
export function mapUpsStatus(type: string | null, description: string | null): PackageStatus {
  const text = description ?? '';
  switch (type) {
    case 'D':
    case 'DO':
    case 'DD':
      return 'delivered';
    case 'O':
      return 'out_for_delivery';
    case 'M':
      return 'pending';
    case 'RS':
      return 'exception';
    case 'X':
      return FAILED.test(text) ? 'failed_attempt' : 'exception';
    case 'P':
    case 'I':
    case 'W':
      if (OUT_FOR_DELIVERY.test(text)) return 'out_for_delivery';
      if (PICKUP_POINT.test(text)) return 'available_for_pickup';
      return 'in_transit';
    default:
      return 'unknown';
  }
}

/** "20260113" / "130000" style values with an optional "-05:00" offset, to an ISO instant. */
function upsTime(date: unknown, time: unknown, offset?: unknown): string | null {
  const d = str(date)?.replace(/-/g, '');
  const t = (str(time) ?? '000000').replace(/:/g, '').padEnd(6, '0');
  if (!d || !/^\d{8}$/.test(d) || !/^\d{6}$/.test(t)) return null;
  const local = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  const off = str(offset);
  return toIso(off && /^[+-]\d{2}:\d{2}$/.test(off) ? `${local}${off}` : local);
}

const place = (loc: unknown): string | null => {
  const address = obj(obj(loc).address);
  return joinParts(address.city, address.stateProvince, address.countryCode);
};

export function parsePackage(raw: unknown): TrackingResult {
  const pkg = obj(raw);

  const events: Array<TrackingEvent & { type: string | null }> = [];
  for (const a of arr(pkg.activity).map(obj)) {
    const status = obj(a.status);
    // Prefer GMT when UPS gives it, so events sort correctly across time zones.
    const time = upsTime(a.gmtDate, a.gmtTime, '+00:00') ?? upsTime(a.date, a.time, a.gmtOffset);
    const description = str(status.description) ?? str(status.simplifiedTextDescription);
    if (!time || !description) continue;
    const type = str(status.type);
    events.push({ time, description, location: place(a.location), status: type ? mapUpsStatus(type, description) : null, type });
  }
  events.sort((x, y) => y.time.localeCompare(x.time));

  const current = obj(pkg.currentStatus);
  const latest = events[0];
  const statusText = str(current.description) ?? str(current.simplifiedTextDescription) ?? latest?.description ?? null;
  const type = latest?.type ?? str(current.type) ?? str(current.statusCode);

  const dates = arr(pkg.deliveryDate).map(obj);
  const expected = dates.find((d) => str(d.type) === 'RDD') ?? dates.find((d) => str(d.type) === 'SDD');
  const expectedDate = str(expected?.date)?.replace(/-/g, '');
  const eta = expectedDate && /^\d{8}$/.test(expectedDate)
    ? toIso(`${expectedDate.slice(0, 4)}-${expectedDate.slice(4, 6)}-${expectedDate.slice(6, 8)}T12:00:00`)
    : null;

  const addresses = arr(pkg.packageAddress).map(obj);
  const addressOf = (kind: string) => place(addresses.find((a) => str(a.type)?.toUpperCase() === kind));

  return {
    status: mapUpsStatus(type, latest?.description ?? statusText),
    statusText,
    carrierCode: 'ups',
    carrierName: 'UPS',
    eta,
    origin: addressOf('ORIGIN'),
    destination: addressOf('DESTINATION'),
    events: events.map(({ type: _type, ...event }) => event),
    providerRef: null,
  };
}
