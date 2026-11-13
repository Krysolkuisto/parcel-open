/** Normalized shipment status, shared by every provider and by the apps. */
export const STATUSES = [
  'unknown',
  'pending',
  'in_transit',
  'out_for_delivery',
  'available_for_pickup',
  'failed_attempt',
  'exception',
  'delivered',
  'expired',
] as const;
export type PackageStatus = (typeof STATUSES)[number];

/** Statuses after which a package no longer needs polling. */
export const FINAL_STATUSES: readonly PackageStatus[] = ['delivered', 'expired'];

export interface TrackingEvent {
  /** ISO-8601 timestamp. */
  time: string;
  description: string;
  location: string | null;
  status: PackageStatus | null;
}

/** What a provider returns for a package, already normalized. Events are newest first. */
export interface TrackingResult {
  status: PackageStatus;
  statusText: string | null;
  carrierCode: string | null;
  carrierName: string | null;
  /** ISO-8601 estimated delivery, when the carrier gives one. */
  eta: string | null;
  origin: string | null;
  destination: string | null;
  events: TrackingEvent[];
  /** Provider-side identifier (AfterShip tracking id, ...). */
  providerRef: string | null;
}

export interface TrackInput {
  trackingNumber: string;
  carrierCode?: string | null;
  postalCode?: string | null;
  providerRef?: string | null;
}

export interface ParsedWebhook {
  trackingNumber: string;
  providerRef: string | null;
  result: TrackingResult;
}

export interface WebhookHandler {
  verify(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parse(rawBody: string): ParsedWebhook[];
}

export interface TrackingProvider {
  readonly name: string;
  /** Whether this provider understands the given carrier code (otherwise auto-detection is used). */
  acceptsCarrier(code: string): boolean;
  /** Start tracking a number and return the first known state. */
  register(input: TrackInput): Promise<TrackingResult>;
  /** Fetch the latest state of an already registered number. */
  refresh(input: TrackInput): Promise<TrackingResult>;
  /** Stop tracking on the provider side (frees quota). Best effort. */
  remove?(input: TrackInput): Promise<void>;
  webhook?: WebhookHandler;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** True for network/rate-limit/5xx failures: the package is kept and retried later. */
    public readonly retryable: boolean,
    public readonly code?: string | number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}
