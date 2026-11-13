import { carrierDisplayName } from '../carriers.js';
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
 * Ship24 tracking API: one key, 1,500+ couriers detected automatically.
 * https://docs.ship24.com/ — Auth: `Authorization: Bearer <key>`.
 * Use the free "Tracking API and Webhook" plan (10 shipments per month, no overage). Do not pick the
 * "per call" plan: every refresh would count against its 100 calls.
 * The request and response shapes follow Ship24's published OpenAPI file.
 */
const BASE_URL = 'https://api.ship24.com/public/v1';

const MILESTONE: Record<string, PackageStatus> = {
  pending: 'unknown',
  info_received: 'pending',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  failed_attempt: 'failed_attempt',
  available_for_pickup: 'available_for_pickup',
  delivered: 'delivered',
  exception: 'exception',
};

export class Ship24Provider implements TrackingProvider {
  readonly name = 'ship24';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  acceptsCarrier(): boolean {
    return false; // couriers are detected automatically
  }

  /** Listing trackers needs the key but does not use a shipment. */
  async verify(): Promise<void> {
    const { status } = await requestJson(this.fetchImpl, `${BASE_URL}/trackers?page=1&limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (status === 401) throw new ProviderError('Ship24 rejected the API key', false, status);
    if (status >= 400) throw new ProviderError(`Ship24 answered HTTP ${status}`, false, status);
  }

  /** Creates the tracker (this is what uses one of the monthly shipments) and returns the first results. */
  async register(input: TrackInput): Promise<TrackingResult> {
    const payload: Json = { trackingNumber: input.trackingNumber };
    if (input.postalCode) payload.destinationPostCode = input.postalCode;
    return this.call('POST', '/trackers/track', payload);
  }

  /** Reads results of the existing tracker: no extra shipment is consumed. */
  async refresh(input: TrackInput): Promise<TrackingResult> {
    if (input.providerRef) {
      return this.call('GET', `/trackers/${encodeURIComponent(input.providerRef)}/results`);
    }
    return this.register(input);
  }

  private async call(method: string, path: string, body?: unknown): Promise<TrackingResult> {
    const { status, body: response } = await requestJson(this.fetchImpl, `${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body,
    });
    const b = obj(response);
    if (status === 401) throw new ProviderError('Ship24 rejected the API key', false, status);
    if (status >= 400) {
      const first = obj(arr(b.errors)[0]);
      throw new ProviderError(
        str(first.message) ?? str(b.message) ?? `Ship24 error (HTTP ${status})`,
        false,
        status,
      );
    }
    const tracking = arr(obj(b.data).trackings)[0];
    if (!tracking) throw new ProviderError('Ship24 returned no tracking data', false);
    return parseTracking(tracking);
  }
}

export function parseTracking(raw: unknown): TrackingResult {
  const t = obj(raw);
  const tracker = obj(t.tracker);
  const shipment = obj(t.shipment);
  const delivery = obj(shipment.delivery);

  const events: TrackingEvent[] = [];
  for (const e of arr(t.events).map(obj)) {
    const time = toIso(e.occurrenceDatetime) ?? toIso(e.datetime);
    const description = str(e.status);
    if (!time || !description) continue;
    const milestone = str(e.statusMilestone);
    events.push({
      time,
      description,
      location: str(e.location),
      status: milestone && milestone !== 'pending' ? (MILESTONE[milestone] ?? null) : null,
    });
  }
  events.sort((a, b) => b.time.localeCompare(a.time));

  const courier = str(arr(tracker.courierCode)[0]) ?? arr(t.events).map((e) => str(obj(e).courierCode)).find(Boolean) ?? null;
  const courierEta = obj(delivery.courierEstimatedDeliveryDate);

  return {
    status: MILESTONE[str(shipment.statusMilestone) ?? ''] ?? 'unknown',
    statusText: events[0]?.description ?? null,
    carrierCode: courier,
    carrierName: courier ? carrierDisplayName(courier) : null,
    eta: toIso(delivery.estimatedDeliveryDate) ?? toIso(courierEta.to) ?? toIso(courierEta.from),
    origin: str(shipment.originCountryCode),
    destination: str(shipment.destinationCountryCode),
    events,
    providerRef: str(tracker.trackerId),
  };
}
