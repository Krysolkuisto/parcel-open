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
  joinParts,
  obj,
  requestJson,
  safeEqual,
  sha256Hex,
  str,
  toIso,
  type FetchLike,
  type Json,
} from './http.js';

/**
 * 17TRACK API v2.4 — https://api.17track.net/en/doc
 * Auth: `17token` header. Every endpoint is a POST taking a JSON array.
 * Webhook: header `sign` = sha256_hex(rawBody + "/" + securityKey).
 */
const BASE_URL = 'https://api.17track.net/track/v2.4';

const MAIN_STATUS: Record<string, PackageStatus> = {
  NotFound: 'unknown',
  InfoReceived: 'pending',
  InTransit: 'in_transit',
  Expired: 'expired',
  AvailableForPickup: 'available_for_pickup',
  OutForDelivery: 'out_for_delivery',
  DeliveryFailure: 'failed_attempt',
  Delivered: 'delivered',
  Exception: 'exception',
};

const STAGE_STATUS: Record<string, PackageStatus> = {
  InfoReceived: 'pending',
  PickedUp: 'in_transit',
  Departure: 'in_transit',
  Arrival: 'in_transit',
  AvailableForPickup: 'available_for_pickup',
  OutForDelivery: 'out_for_delivery',
  Delivered: 'delivered',
  Returned: 'exception',
  Returning: 'exception',
  DeliveryFailure: 'failed_attempt',
};

const ALREADY_REGISTERED = new Set([-18019901]);
const NOT_REGISTERED = new Set([-18019902]);

export class Track17Provider implements TrackingProvider {
  readonly name = '17track';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  acceptsCarrier(code: string): boolean {
    return /^\d+$/.test(code);
  }

  private async call(path: string, payload: Json[]): Promise<{ accepted: Json[]; rejected: Json[] }> {
    const { status, body } = await requestJson(this.fetchImpl, `${BASE_URL}${path}`, {
      method: 'POST',
      headers: { '17token': this.apiKey },
      body: payload,
    });
    const b = obj(body);
    if (status === 401 || status === 403) {
      throw new ProviderError('17TRACK rejected the API key', false, status);
    }
    if (status >= 400 || (typeof b.code === 'number' && b.code !== 0)) {
      throw new ProviderError(
        `17TRACK error ${String(b.code ?? status)}${str(obj(b.data).message) ? `: ${str(obj(b.data).message)}` : ''}`,
        false,
        typeof b.code === 'number' ? b.code : status,
      );
    }
    const data = obj(b.data);
    return { accepted: arr(data.accepted).map(obj), rejected: arr(data.rejected).map(obj) };
  }

  private entry(input: TrackInput): Json {
    const e: Json = { number: input.trackingNumber };
    if (input.carrierCode && this.acceptsCarrier(input.carrierCode)) e.carrier = Number(input.carrierCode);
    return e;
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    const entry = this.entry(input);
    if (input.postalCode) entry.destination_postal_code = input.postalCode;
    const { rejected } = await this.call('/register', [entry]);
    const failure = rejected[0];
    if (failure) {
      const err = obj(failure.error);
      if (!ALREADY_REGISTERED.has(Number(err.code))) {
        throw new ProviderError(str(err.message) ?? '17TRACK rejected this tracking number', false, Number(err.code));
      }
    }
    return this.refresh(input, false);
  }

  async refresh(input: TrackInput, retryRegister = true): Promise<TrackingResult> {
    const { accepted, rejected } = await this.call('/gettrackinfo', [this.entry(input)]);
    const ok = accepted[0];
    if (ok) return parseAccepted(ok);

    const err = obj(rejected[0]?.error);
    if (retryRegister && NOT_REGISTERED.has(Number(err.code))) return this.register(input);
    throw new ProviderError(str(err.message) ?? 'No tracking data returned by 17TRACK', false, Number(err.code));
  }

  /** Asks for the account quota: needs the key, uses none. */
  async verify(): Promise<void> {
    const { status, body } = await requestJson(this.fetchImpl, `${BASE_URL}/getquota`, {
      method: 'POST',
      headers: { '17token': this.apiKey },
    });
    const code = obj(body).code;
    if (status === 401 || status === 403) throw new ProviderError('17TRACK rejected the API key', false, status);
    if (status >= 400 || (typeof code === 'number' && code !== 0)) {
      throw new ProviderError(`17TRACK answered ${String(code ?? status)}`, false);
    }
  }

  async remove(input: TrackInput): Promise<void> {
    await this.call('/deletetrack', [this.entry(input)]);
  }

  readonly webhook = {
    verify: (headers: Record<string, string | string[] | undefined>, rawBody: string): boolean => {
      const sign = headerValue(headers, 'sign');
      return !!sign && safeEqual(sign.toLowerCase(), sha256Hex(`${rawBody}/${this.apiKey}`));
    },
    parse: (rawBody: string): ParsedWebhook[] => {
      const body = obj(JSON.parse(rawBody));
      const data = obj(body.data);
      // Push payloads carry one item in `data`; tolerate the `accepted[]` shape too.
      const items = arr(data.accepted).length ? arr(data.accepted).map(obj) : data.number ? [data] : [];
      return items.map((item) => ({
        trackingNumber: String(item.number),
        providerRef: null,
        result: parseAccepted(item),
      }));
    },
  };
}

export function parseAccepted(item: Json): TrackingResult {
  const info = obj(item.track_info);
  const latest = obj(info.latest_status);
  const latestEvent = obj(info.latest_event);
  const providers = arr(obj(info.tracking).providers).map(obj);

  const events: TrackingEvent[] = [];
  for (const p of providers) {
    for (const e of arr(p.events).map(obj)) {
      const time = toIso(e.time_iso) ?? toIso(e.time_utc);
      const description = str(e.description) ?? str(e.description_translation);
      if (!time || !description) continue;
      events.push({
        time,
        description,
        location: str(e.location),
        status: STAGE_STATUS[str(e.stage) ?? ''] ?? null,
      });
    }
  }
  events.sort((a, b) => b.time.localeCompare(a.time));

  const status = MAIN_STATUS[str(latest.status) ?? ''] ?? (str(item.tag) ? MAIN_STATUS[String(item.tag)] : undefined) ?? 'unknown';
  const estimated = obj(obj(info.time_metrics).estimated_delivery_date);
  const shipping = obj(info.shipping_info);
  const place = (a: unknown): string | null => {
    const addr = obj(a);
    return joinParts(addr.city, addr.state, addr.country);
  };
  // A package can list several carriers (origin and destination, e.g. DHL Paket then La Poste). The one that
  // actually reported events is the one currently handling it; the others are usually still empty.
  const main = providers.reduce<Json | undefined>(
    (best, p) => (arr(p.events).length > arr(best?.events).length ? p : best),
    providers[0],
  );
  const provider = obj(main?.provider);

  return {
    status,
    statusText: str(latest.sub_status_descr) ?? str(latestEvent.description) ?? events[0]?.description ?? null,
    carrierCode: item.carrier === undefined || item.carrier === null ? null : String(item.carrier),
    carrierName: str(provider.name) ?? str(provider.alias),
    eta: toIso(estimated.to) ?? toIso(estimated.from),
    origin: place(shipping.shipper_address),
    destination: place(shipping.recipient_address),
    events,
    providerRef: null,
  };
}
