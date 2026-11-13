import { detectCarrier } from '../carriers.js';
import {
  ProviderError,
  type PackageStatus,
  type TrackInput,
  type TrackingEvent,
  type TrackingProvider,
  type TrackingResult,
} from '../domain.js';
import { arr, obj, requestJson, str, toIso, type FetchLike, type Json } from './http.js';

/**
 * La Poste "Suivi v2" API: Colissimo, Chronopost and tracked mail, free key from developer.laposte.fr.
 * Auth: `X-Okapi-Key` header. GET https://api.laposte.fr/suivi/v2/idships/{number}?lang=fr_FR
 * Field names were taken from open-source clients of this API (debuss/lapostesuivi), not from live calls.
 */
const BASE_URL = 'https://api.laposte.fr/suivi/v2/idships';

/** Event codes with a known meaning (from La Poste's v2 event list). */
const EVENT_STATUS: Record<string, PackageStatus> = {
  DR1: 'pending', // announced by the sender
  PC1: 'in_transit',
  PC2: 'in_transit',
  DO1: 'in_transit',
  DO2: 'in_transit',
  DO3: 'in_transit',
  AG1: 'available_for_pickup',
  MD2: 'delivered',
  DI1: 'delivered',
  DI2: 'delivered',
  RE1: 'exception', // returned to sender
};

const OUT_FOR_DELIVERY = /en cours de livraison|out for delivery|en livraison/i;

export class LaPosteProvider implements TrackingProvider {
  readonly name = 'laposte';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly lang = 'fr_FR',
  ) {}

  acceptsCarrier(): boolean {
    return false;
  }

  /** Colissimo numbers and La Poste / Chronopost S10 numbers ending in FR. */
  canTrack(trackingNumber: string): boolean {
    const code = detectCarrier(trackingNumber)?.code;
    return code === 'colissimo' || code === 'la-poste';
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    return this.refresh(input);
  }

  /** An unknown number answers 404; a bad key answers 401. Either way, no quota question arises. */
  async verify(): Promise<void> {
    const { status } = await this.fetchNumber('6A00000000000');
    if (status === 401 || status === 403) throw new ProviderError('La Poste rejected the API key', false, status);
    if (status >= 500) throw new ProviderError(`La Poste answered HTTP ${status}`, false, status);
  }

  async refresh(input: TrackInput): Promise<TrackingResult> {
    if (!this.canTrack(input.trackingNumber)) {
      throw new ProviderError('This does not look like a La Poste or Colissimo tracking number', false);
    }
    const { status, body } = await this.fetchNumber(input.trackingNumber);
    const b = obj(Array.isArray(body) ? body[0] : body);
    const code = Number(b.returnCode ?? status);

    if (status === 401 || status === 403 || code === 401) throw new ProviderError('La Poste rejected the API key', false, 401);
    if (status === 404 || code === 404) return emptyResult(); // announced but not scanned yet
    if (status >= 400 || code >= 400) {
      throw new ProviderError(str(b.returnMessage) ?? `La Poste error (HTTP ${status})`, false, code);
    }
    return b.shipment ? parseShipment(b.shipment) : emptyResult();
  }

  private fetchNumber(number: string) {
    return requestJson(this.fetchImpl, `${BASE_URL}/${encodeURIComponent(number)}?lang=${this.lang}`, {
      method: 'GET',
      headers: { 'X-Okapi-Key': this.apiKey },
    });
  }
}

function emptyResult(): TrackingResult {
  return {
    status: 'unknown',
    statusText: null,
    carrierCode: 'colissimo',
    carrierName: 'La Poste',
    eta: null,
    origin: null,
    destination: null,
    events: [],
    providerRef: null,
  };
}

const PRODUCT_NAMES: Record<string, string> = {
  colissimo: 'Colissimo',
  chronopost: 'Chronopost',
  lettre: 'La Poste',
  courrier: 'La Poste',
};

/** Timeline steps: 1 handed over, 2 on its way, 3 reached the delivery site, 4 out for delivery, 5 delivered. */
function statusFromTimeline(timeline: Json[]): PackageStatus | null {
  const reached = timeline.filter((t) => t.status === true).map((t) => Number(t.id)).filter(Number.isFinite);
  if (reached.length === 0) return null;
  const step = Math.max(...reached);
  if (step >= 5) return 'delivered';
  if (step === 4) return 'out_for_delivery';
  return 'in_transit';
}

export function parseShipment(raw: unknown): TrackingResult {
  const s = obj(raw);

  const events: Array<TrackingEvent & { code: string | null }> = [];
  for (const e of arr(s.event).map(obj)) {
    const time = toIso(e.date);
    const description = str(e.label);
    if (!time || !description) continue;
    const code = str(e.code);
    events.push({
      time,
      description,
      location: null, // events carry no place; only a country on timeline steps
      status: code ? (EVENT_STATUS[code] ?? (OUT_FOR_DELIVERY.test(description) ? 'out_for_delivery' : null)) : null,
      code,
    });
  }
  events.sort((a, b) => b.time.localeCompare(a.time));

  const latest = events[0];
  const known = latest?.code ? EVENT_STATUS[latest.code] : undefined;
  const status: PackageStatus =
    known ??
    (latest && OUT_FOR_DELIVERY.test(latest.description) ? 'out_for_delivery' : null) ??
    statusFromTimeline(arr(s.timeline).map(obj)) ??
    'unknown';

  const context = obj(s.contextData);
  const product = str(s.product)?.toLowerCase() ?? '';

  return {
    status,
    statusText: latest?.description ?? null,
    carrierCode: product || 'colissimo',
    carrierName: PRODUCT_NAMES[product] ?? (str(s.product) ? str(s.product)![0]!.toUpperCase() + str(s.product)!.slice(1) : 'La Poste'),
    eta: toIso(s.estimDate),
    origin: str(context.originCountry),
    destination: str(context.arrivalCountry),
    events: events.map(({ code: _code, ...event }) => event),
    providerRef: null,
  };
}
