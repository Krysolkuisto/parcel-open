import { EventEmitter } from 'node:events';
import {
  FINAL_STATUSES,
  HttpError,
  ProviderError,
  normalizeTrackingNumber,
  type PackageStatus,
  type ParsedWebhook,
  type TrackingEvent,
  type TrackingProvider,
  type TrackingResult,
} from './domain.js';
import { detectCarrier, trackingUrl, type DetectedCarrier } from './carriers.js';
import { NoGeocoder, type Geocoder } from './geocode.js';
import type { PackageRow, Store } from './store.js';

export interface PackageView {
  id: string;
  trackingNumber: string;
  label: string | null;
  description: string | null;
  carrierCode: string | null;
  carrierName: string | null;
  /** Which tracking provider supplies the data. "mock" is fake demo data, "manual" means no provider can track it. */
  provider: string;
  /** Public page to follow the parcel by hand (carrier site, or 17TRACK). */
  trackingUrl: string;
  status: PackageStatus;
  statusText: string | null;
  eta: string | null;
  origin: string | null;
  destination: string | null;
  deliveredAt: string | null;
  archived: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastEvent: TrackingEvent | null;
  events?: TrackingEvent[];
  /** Where the package last was, when the place could be geocoded. Only on single-package reads. */
  position?: { lat: number; lon: number; place: string } | null;
}

export interface WidgetView {
  generatedAt: string;
  activeCount: number;
  outForDeliveryCount: number;
  items: Array<{
    id: string;
    title: string;
    trackingNumber: string;
    carrierName: string | null;
    status: PackageStatus;
    statusText: string | null;
    eta: string | null;
  }>;
}

export interface AddPackageInput {
  trackingNumber: string;
  label?: string | null;
  description?: string | null;
  carrierCode?: string | null;
  postalCode?: string | null;
}

export interface StatusChange {
  package: PackageView;
  previous: PackageStatus;
}

/** Lower rank = shown first. Mirrors Parcel: things needing attention on top, delivered at the bottom. */
const RANK: Record<PackageStatus, number> = {
  out_for_delivery: 0,
  exception: 1,
  failed_attempt: 1,
  available_for_pickup: 2,
  in_transit: 3,
  pending: 4,
  unknown: 5,
  delivered: 6,
  expired: 7,
};

const noGeocoder = new NoGeocoder();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TrackingService extends EventEmitter<{ statusChanged: [StatusChange] }> {
  private refreshing = false;

  constructor(
    private readonly store: Store,
    private readonly providers: TrackingProvider[],
    private readonly options: { refreshSpacingMs: number; geocoder?: Geocoder } = { refreshSpacingMs: 0 },
  ) {
    super();
  }

  providerByName(name: string): TrackingProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  /**
   * Demo data left over from the mock provider (e.g. before a real key was configured) is dropped:
   * those packages become plain tracking-link packages again.
   */
  discardUnavailableDemoData(): number {
    if (this.providerByName('mock')) return 0;
    let cleaned = 0;
    for (const row of this.store.list(true)) {
      if (row.provider !== 'mock') continue;
      this.store.deleteEvents(row.id);
      this.store.update(row.id, {
        provider: 'manual',
        provider_ref: null,
        status: 'unknown',
        status_text: null,
        eta: null,
        origin: null,
        destination: null,
        delivered_at: null,
        carrier_code: null,
        carrier_name: detectCarrier(row.tracking_number)?.name ?? null,
      });
      cleaned++;
    }
    return cleaned;
  }

  // ---- queries ------------------------------------------------------------

  list(includeArchived = false): PackageView[] {
    return this.store
      .list(includeArchived)
      .map((row) => this.view(row))
      .sort((a, b) => {
        const byRank = RANK[a.status] - RANK[b.status];
        return byRank !== 0 ? byRank : b.updatedAt.localeCompare(a.updatedAt);
      });
  }

  get(id: string): PackageView {
    return this.view(this.mustGet(id), true);
  }

  /** Like `get`, plus the geocoded position of the most recent known place. */
  async getWithPosition(id: string): Promise<PackageView> {
    const view = this.get(id);
    const place = this.currentPlace(view);
    const point = place ? await this.geocoder.locate(place) : null;
    return { ...view, position: point && place ? { ...point, place } : null };
  }

  detectCarrier(trackingNumber: string): DetectedCarrier | null {
    return detectCarrier(trackingNumber);
  }

  widget(limit = 5): WidgetView {
    const active = this.list(false).filter((p) => !FINAL_STATUSES.includes(p.status));
    return {
      generatedAt: new Date().toISOString(),
      activeCount: active.length,
      outForDeliveryCount: active.filter((p) => p.status === 'out_for_delivery').length,
      items: active.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.label ?? p.trackingNumber,
        trackingNumber: p.trackingNumber,
        carrierName: p.carrierName,
        status: p.status,
        statusText: p.statusText,
        eta: p.eta,
      })),
    };
  }

  // ---- commands -----------------------------------------------------------

  async add(input: AddPackageInput): Promise<PackageView> {
    const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
    if (!/^[A-Z0-9]{5,40}$/.test(trackingNumber)) {
      throw new HttpError(422, 'Invalid tracking number (5 to 40 letters or digits expected)');
    }
    if (this.store.getByNumber(trackingNumber)) {
      throw new HttpError(409, 'This tracking number is already tracked');
    }

    const guessed = detectCarrier(trackingNumber);
    const row = this.store.insert({
      trackingNumber,
      label: input.label?.trim() || null,
      description: input.description?.trim() || null,
      carrierCode: input.carrierCode?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      provider: this.providers.find((p) => p.canTrack?.(trackingNumber) ?? true)?.name ?? 'manual',
    });
    if (guessed) this.store.update(row.id, { carrier_name: guessed.name });

    const candidates = this.providers.filter((p) => p.canTrack?.(trackingNumber) ?? true);
    if (candidates.length === 0) {
      // Keep it anyway: the user can follow it through the tracking link, and it is picked up
      // automatically if a provider able to handle it is configured later.
      return this.get(row.id);
    }

    const errors: ProviderError[] = [];
    for (const provider of candidates) {
      try {
        const result = await provider.register({
          trackingNumber,
          carrierCode: row.carrier_code,
          postalCode: row.postal_code,
        });
        this.apply(row.id, provider.name, result);
        return this.get(row.id);
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        errors.push(err);
      }
    }

    // Temporary outage: keep the package, a later refresh will retry.
    if (errors.some((e) => e.retryable)) {
      this.store.update(row.id, {
        last_error: errors.find((e) => e.retryable)!.message,
        last_checked_at: new Date().toISOString(),
      });
      return this.get(row.id);
    }
    this.store.delete(row.id);
    throw new HttpError(422, errors[0]?.message ?? 'No provider accepted this tracking number');
  }

  update(id: string, patch: { label?: string | null; description?: string | null; archived?: boolean }): PackageView {
    this.mustGet(id);
    this.store.update(id, {
      label: patch.label === undefined ? undefined : patch.label?.trim() || null,
      description: patch.description === undefined ? undefined : patch.description?.trim() || null,
      archived: patch.archived === undefined ? undefined : patch.archived ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const row = this.mustGet(id);
    const provider = this.providerByName(row.provider);
    try {
      await provider?.remove?.({
        trackingNumber: row.tracking_number,
        carrierCode: row.carrier_code,
        providerRef: row.provider_ref,
      });
    } catch {
      // Best effort: the local deletion must not depend on the provider being reachable.
    }
    this.store.delete(id);
  }

  async refresh(id: string): Promise<PackageView> {
    const row = this.mustGet(id);
    try {
      await this.refreshRow(row);
    } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(502, err.message);
      throw err;
    }
    return this.get(id);
  }

  /** Refreshes every package that is still in progress. Safe to call concurrently (extra calls are skipped). */
  async refreshAll(): Promise<{ refreshed: number; failed: number; skipped: boolean }> {
    if (this.refreshing) return { refreshed: 0, failed: 0, skipped: true };
    this.refreshing = true;
    let refreshed = 0;
    let failed = 0;
    try {
      const active = this.store
        .list(false)
        .filter((r) => !FINAL_STATUSES.includes(r.status) && this.pickProvider(r));
      for (const [i, row] of active.entries()) {
        if (i > 0 && this.options.refreshSpacingMs > 0) await sleep(this.options.refreshSpacingMs);
        try {
          await this.refreshRow(row);
          refreshed++;
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err;
          failed++;
        }
      }
    } finally {
      this.refreshing = false;
    }
    return { refreshed, failed, skipped: false };
  }

  /** Applies provider push notifications. Unknown tracking numbers are ignored. */
  handleWebhook(providerName: string, items: ParsedWebhook[]): number {
    let applied = 0;
    for (const item of items) {
      const row = this.store.getByNumber(normalizeTrackingNumber(item.trackingNumber));
      if (!row) continue;
      this.apply(row.id, providerName, item.result, item.providerRef);
      applied++;
    }
    return applied;
  }

  // ---- internals ----------------------------------------------------------

  private mustGet(id: string): PackageRow {
    const row = this.store.get(id);
    if (!row) throw new HttpError(404, 'Package not found');
    return row;
  }

  /** The package's own provider if still configured, else the first one able to handle its number. */
  private pickProvider(row: PackageRow): TrackingProvider | undefined {
    return (
      this.providerByName(row.provider) ?? this.providers.find((p) => p.canTrack?.(row.tracking_number) ?? true)
    );
  }

  private async refreshRow(row: PackageRow): Promise<void> {
    const provider = this.pickProvider(row);
    if (!provider) return; // nobody can track this number automatically
    try {
      const result = await provider.refresh({
        trackingNumber: row.tracking_number,
        carrierCode: row.carrier_code,
        postalCode: row.postal_code,
        providerRef: row.provider_ref,
      });
      this.apply(row.id, provider.name, result);
    } catch (err) {
      if (err instanceof ProviderError) {
        this.store.update(row.id, { last_error: err.message, last_checked_at: new Date().toISOString() });
      }
      throw err;
    }
  }

  private apply(id: string, providerName: string, result: TrackingResult, providerRef: string | null = null): void {
    let row = this.mustGet(id);
    const now = new Date().toISOString();

    // Data from another provider (e.g. demo data before a real API key was added) must not linger:
    // forget everything it said and start from what the new provider reports.
    if (row.provider !== providerName) {
      this.store.deleteEvents(id);
      row = {
        ...row,
        provider: providerName,
        provider_ref: null,
        status: 'unknown',
        status_text: null,
        carrier_code: null,
        carrier_name: row.carrier_name && detectCarrier(row.tracking_number)?.name === row.carrier_name ? row.carrier_name : null,
        eta: null,
        origin: null,
        destination: null,
        delivered_at: null,
      };
    }
    this.store.saveEvents(id, result.events);

    // A provider that has no data yet must not erase what we already know.
    const status = result.status === 'unknown' && row.status !== 'unknown' ? row.status : result.status;

    this.store.update(id, {
      provider: providerName,
      provider_ref: result.providerRef ?? providerRef ?? row.provider_ref,
      status,
      status_text: result.statusText ?? row.status_text,
      carrier_code: result.carrierCode ?? row.carrier_code,
      carrier_name: result.carrierName ?? row.carrier_name,
      eta: status === 'delivered' ? null : (result.eta ?? row.eta),
      origin: result.origin ?? row.origin,
      destination: result.destination ?? row.destination,
      delivered_at:
        status === 'delivered' ? (row.delivered_at ?? this.store.latestEvent(id)?.time ?? now) : null,
      last_checked_at: now,
      last_error: null,
      updated_at: status !== row.status ? now : row.updated_at,
    });

    if (status !== row.status) {
      this.emit('statusChanged', { package: this.get(id), previous: row.status });
    }

    // Look the place up now so the map is ready when the user opens the package.
    const place = this.currentPlace(this.get(id));
    if (place) void this.geocoder.locate(place).catch(() => undefined);
  }

  private get geocoder(): Geocoder {
    return this.options.geocoder ?? noGeocoder;
  }

  private currentPlace(view: PackageView): string | null {
    return view.events?.find((e) => e.location)?.location ?? view.lastEvent?.location ?? view.destination ?? null;
  }

  private view(row: PackageRow, withEvents = false): PackageView {
    const events = withEvents ? this.store.events(row.id) : undefined;
    return {
      id: row.id,
      trackingNumber: row.tracking_number,
      label: row.label,
      description: row.description,
      carrierCode: row.carrier_code,
      carrierName: row.carrier_name,
      provider: row.provider,
      trackingUrl: trackingUrl(row.tracking_number, detectCarrier(row.tracking_number)?.code ?? row.carrier_code),
      status: row.status,
      statusText: row.status_text,
      eta: row.eta,
      origin: row.origin,
      destination: row.destination,
      deliveredAt: row.delivered_at,
      archived: row.archived === 1,
      lastCheckedAt: row.last_checked_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastEvent: events ? (events[0] ?? null) : this.store.latestEvent(row.id),
      ...(events ? { events } : {}),
    };
  }
}
