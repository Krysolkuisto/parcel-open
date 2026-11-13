import type { PackageStatus, TrackInput, TrackingEvent, TrackingProvider, TrackingResult } from '../domain.js';

/**
 * Offline provider for development and demos: no API key, deterministic output.
 * The last digit of the tracking number picks the scenario.
 */
const SCENARIOS: Record<string, PackageStatus> = {
  '0': 'delivered',
  '1': 'out_for_delivery',
  '2': 'exception',
  '3': 'pending',
  '4': 'available_for_pickup',
  '5': 'failed_attempt',
};

const HOUR = 3_600_000;

export class MockProvider implements TrackingProvider {
  readonly name = 'mock';

  constructor(private readonly now: () => number = Date.now) {}

  acceptsCarrier(): boolean {
    return false;
  }

  async register(input: TrackInput): Promise<TrackingResult> {
    return this.build(input.trackingNumber);
  }

  async refresh(input: TrackInput): Promise<TrackingResult> {
    return this.build(input.trackingNumber);
  }

  private build(number: string): TrackingResult {
    const last = number.slice(-1);
    const status: PackageStatus = SCENARIOS[last] ?? 'in_transit';
    const now = this.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();

    const timeline: Array<[number, string, string, PackageStatus]> = [
      [60, 'Shipping label created', 'Corbeil-Essonnes, FR', 'pending'],
      [48, 'Picked up by carrier', 'Corbeil-Essonnes, FR', 'in_transit'],
      [30, 'Departed facility', 'Paris, FR', 'in_transit'],
      [12, 'Arrived at sorting facility', 'Lyon, FR', 'in_transit'],
    ];
    if (status === 'out_for_delivery') timeline.push([2, 'Out for delivery', 'Meyzieu, FR', status]);
    if (status === 'delivered') {
      timeline.push([4, 'Out for delivery', 'Meyzieu, FR', 'out_for_delivery']);
      timeline.push([1, 'Delivered', 'Meyzieu, FR', status]);
    }
    if (status === 'exception') timeline.push([3, 'Delivery exception: address issue', 'Meyzieu, FR', status]);
    if (status === 'failed_attempt') timeline.push([3, 'Delivery attempted, recipient absent', 'Meyzieu, FR', status]);
    if (status === 'available_for_pickup') timeline.push([2, 'Ready for pickup at relay point', 'Meyzieu, FR', status]);
    const keep = status === 'pending' ? 1 : timeline.length;

    const events: TrackingEvent[] = timeline
      .slice(0, keep)
      .map(([h, description, location, s]) => ({ time: at(h), description, location, status: s }))
      .reverse();

    return {
      status,
      statusText: events[0]?.description ?? null,
      carrierCode: 'mock',
      carrierName: 'Mock Carrier',
      eta: status === 'delivered' ? null : new Date(now + 24 * HOUR).toISOString(),
      origin: 'Corbeil-Essonnes, FR',
      destination: 'Meyzieu, FR',
      events,
      providerRef: null,
    };
  }
}
