import { isDhlNumber } from '../carriers.js';
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
 * DHL "Shipment Tracking - Unified" API, free of charge (250 calls per day on a new key):
 * https://developer.dhl.com/api-reference/shipment-tracking
 * Covers DHL Paket, DHL Express and DHL eCommerce parcels. Auth: `DHL-API-Key` header.
 * The response shape below was checked against the portal's public demo key.
 */
const BASE_URL = 'https://api-eu.dhl.com/track/shipments';

const SERVICE_NAMES: Record<string, string> = {
  express: 'DHL Express',
  ecommerce: 'DHL eCommerce',
  'parcel-de': 'DHL Paket',
  'parcel-nl': 'DHL Parcel NL',
  'parcel-uk': 'DHL Parcel UK',
  freight: 'DHL Freight',
};

const OUT_FOR_DELIVERY = /out for delivery|in zustellung|zustellfahrzeug|en cours de livraison/i;
const PICKUP = /ready for (pick ?up|collection)|packstation|abholbereit|retrait|parcel ?shop/i;

/** DHL status codes are coarse (pre-transit, transit, delivered, failure, unknown); the text tells more. */
export function mapDhlStatus(code: string | null, text: string | null): PackageStatus {
  switch (code) {
    case 'delivered':
      return 'delivered';
    case 'failure':
      return 'failed_attempt';
    case 'pre-transit':
      return 'pending';
    case 'transit':
      if (text && OUT_FOR_DELIVERY.test(text)) return 'out_for_delivery';
      if (text && PICKUP.test(text)) return 'available_for_pickup';
      return 'in_transit';
    default:
      return 'unknown';
  }
}

export class DhlProvider implements TrackingProvider {
  readonly name = 'dhl';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly language = 'en',
  ) {}

  acceptsCarrier(): boolean {
    return false; // the API detects the DHL service by itself
  }

  canTrack(trackingNumber: string): boolean {
    return isDhlNumber(trackingNumber);
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    return this.refresh(input);
  }

  async refresh(input: TrackInput): Promise<TrackingResult> {
    if (!this.canTrack(input.trackingNumber)) {
      throw new ProviderError('This does not look like a DHL tracking number', false);
    }
    const url = `${BASE_URL}?${new URLSearchParams({ trackingNumber: input.trackingNumber, language: this.language })}`;
    const { status, body } = await requestJson(this.fetchImpl, url, {
      method: 'GET',
      headers: { 'DHL-API-Key': this.apiKey },
    });
    const b = obj(body);

    if (status === 401 || status === 403) throw new ProviderError('DHL rejected the API key', false, status);
    if (status === 404) return emptyResult(); // announced but not scanned yet: keep the package and retry later
    if (status >= 400) {
      throw new ProviderError(str(b.detail) ?? str(b.title) ?? `DHL error (HTTP ${status})`, false, status);
    }
    const shipment = arr(b.shipments)[0];
    return shipment ? parseShipment(shipment) : emptyResult();
  }
}

function emptyResult(): TrackingResult {
  return {
    status: 'unknown',
    statusText: null,
    carrierCode: 'dhl',
    carrierName: 'DHL',
    eta: null,
    origin: null,
    destination: null,
    events: [],
    providerRef: null,
  };
}

const place = (loc: unknown): string | null => {
  const address = obj(obj(loc).address);
  return str(address.addressLocality) ?? str(address.countryCode);
};

const placeWithCountry = (loc: unknown): string | null => {
  const address = obj(obj(loc).address);
  return joinParts(address.addressLocality, address.countryCode);
};

export function parseShipment(raw: unknown): TrackingResult {
  const s = obj(raw);
  const current = obj(s.status);

  const events: TrackingEvent[] = [];
  for (const e of arr(s.events).map(obj)) {
    const time = toIso(e.timestamp);
    const description = str(e.description) ?? str(e.status);
    if (!time || !description) continue;
    events.push({
      time,
      description,
      location: place(e.location),
      status: str(e.statusCode) ? mapDhlStatus(str(e.statusCode), str(e.status) ?? description) : null,
    });
  }
  events.sort((a, b) => b.time.localeCompare(a.time));

  const code = str(current.statusCode);
  const text = str(current.description) ?? str(current.status);
  const service = str(s.service);

  return {
    status: mapDhlStatus(code, str(current.status) ?? text),
    statusText: text ?? events[0]?.description ?? null,
    carrierCode: 'dhl',
    carrierName: (service && SERVICE_NAMES[service]) || 'DHL',
    eta: toIso((s as Json).estimatedTimeOfDelivery),
    origin: placeWithCountry(s.origin),
    destination: placeWithCountry(s.destination),
    events,
    providerRef: null,
  };
}
