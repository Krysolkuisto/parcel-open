import {
  ProviderError,
  type PackageStatus,
  type ParsedWebhook,
  type TrackInput,
  type TrackingEvent,
  type TrackingProvider,
  type TrackingResult,
} from '../domain.js';
import {
  arr,
  headerValue,
  hmacSha256Base64,
  joinParts,
  obj,
  requestJson,
  safeEqual,
  str,
  toIso,
  type FetchLike,
  type Json,
} from './http.js';

/**
 * AfterShip Tracking API 2025-07 — https://www.aftership.com/docs/tracking
 * Auth: `as-api-key` header. Webhook: header `aftership-hmac-sha256` = base64(HMAC-SHA256(rawBody, secret)).
 * Field names follow the official SDK types (@aftership/tracking-sdk v17).
 */
const BASE_URL = 'https://api.aftership.com/tracking/2025-07';

const TAG_STATUS: Record<string, PackageStatus> = {
  Pending: 'unknown',
  InfoReceived: 'pending',
  InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  AttemptFail: 'failed_attempt',
  Delivered: 'delivered',
  AvailableForPickup: 'available_for_pickup',
  Exception: 'exception',
  Expired: 'expired',
};

export class AfterShipProvider implements TrackingProvider {
  readonly name = 'aftership';

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string | null = null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  acceptsCarrier(code: string): boolean {
    return /^[a-z][a-z0-9-]*$/i.test(code);
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await requestJson(this.fetchImpl, `${BASE_URL}${path}`, {
      method,
      headers: { 'as-api-key': this.apiKey },
      body,
    });
    return { status: res.status, body: obj(res.body) };
  }

  private fail(status: number, body: Json): never {
    const meta = obj(body.meta);
    if (status === 401 || status === 403) throw new ProviderError('AfterShip rejected the API key', false, status);
    throw new ProviderError(str(meta.message) ?? `AfterShip error (HTTP ${status})`, false, Number(meta.code ?? status));
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    const payload: Json = { tracking_number: input.trackingNumber };
    if (input.carrierCode && this.acceptsCarrier(input.carrierCode)) payload.slug = input.carrierCode;
    if (input.postalCode) payload.tracking_postal_code = input.postalCode;

    const { status, body } = await this.call('POST', '/trackings', payload);
    if (status === 409 || Number(obj(body.meta).code) === 4003) {
      return this.refresh({ ...input, providerRef: null }); // already exists: look it up
    }
    if (status >= 400) this.fail(status, body);
    return parseTracking(obj(body.data).tracking ?? body.data);
  }

  async refresh(input: TrackInput): Promise<TrackingResult> {
    if (input.providerRef) {
      const { status, body } = await this.call('GET', `/trackings/${encodeURIComponent(input.providerRef)}`);
      if (status < 400) return parseTracking(obj(body.data).tracking ?? body.data);
      if (status !== 404) this.fail(status, body);
    }
    const qs = new URLSearchParams({ tracking_numbers: input.trackingNumber });
    const { status, body } = await this.call('GET', `/trackings?${qs.toString()}`);
    if (status >= 400) this.fail(status, body);
    const first = arr(obj(body.data).trackings)[0];
    if (!first) return this.register({ ...input, providerRef: null });
    return parseTracking(first);
  }

  async remove(input: TrackInput): Promise<void> {
    if (!input.providerRef) return;
    await this.call('DELETE', `/trackings/${encodeURIComponent(input.providerRef)}`);
  }

  readonly webhook = {
    verify: (headers: Record<string, string | string[] | undefined>, rawBody: string): boolean => {
      if (!this.webhookSecret) return false;
      const sig = headerValue(headers, 'aftership-hmac-sha256');
      return !!sig && safeEqual(sig, hmacSha256Base64(this.webhookSecret, rawBody));
    },
    parse: (rawBody: string): ParsedWebhook[] => {
      const body = obj(JSON.parse(rawBody));
      const raw = obj(body.data).tracking ?? body.msg ?? body.data;
      const tracking = obj(raw);
      const number = str(tracking.tracking_number);
      if (!number) return [];
      return [{ trackingNumber: number, providerRef: str(tracking.id), result: parseTracking(tracking) }];
    },
  };
}

export function parseTracking(raw: unknown): TrackingResult {
  const t = obj(raw);
  const checkpoints = arr(t.checkpoints).map(obj);

  const events: TrackingEvent[] = [];
  for (const c of checkpoints) {
    const time = toIso(c.checkpoint_time) ?? toIso(c.created_at);
    const description = str(c.message) ?? str(c.subtag_message);
    if (!time || !description) continue;
    events.push({
      time,
      description,
      location: str(c.location) ?? joinParts(c.city, c.state, c.country_region_name),
      status: TAG_STATUS[str(c.tag) ?? ''] ?? null,
    });
  }
  events.sort((a, b) => b.time.localeCompare(a.time));

  const tag = str(t.tag) ?? '';
  const eta =
    toIso(obj(t.aftership_estimated_delivery_date).estimated_delivery_date) ??
    toIso(obj(t.courier_estimated_delivery_date).estimated_delivery_date) ??
    toIso(obj(t.latest_estimated_delivery).datetime) ??
    toIso(t.shipment_delivery_date);

  return {
    status: TAG_STATUS[tag] ?? 'unknown',
    statusText: str(t.subtag_message) ?? events[0]?.description ?? null,
    carrierCode: str(t.slug),
    carrierName: str(t.slug),
    eta,
    origin: joinParts(t.origin_city, t.origin_state, t.origin_country_region),
    destination: joinParts(t.destination_city, t.destination_state, t.destination_country_region),
    events,
    providerRef: str(t.id),
  };
}
