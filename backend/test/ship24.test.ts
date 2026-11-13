import { describe, expect, it, vi } from 'vitest';
import { Ship24Provider, parseTracking } from '../src/providers/ship24.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Shaped after Ship24's published OpenAPI schema (data.trackings[].tracker / shipment / events).
const tracking = {
  tracker: { trackerId: 'trk_123', trackingNumber: 'RB123456789TH', courierCode: ['thailand-post'], isTracked: true },
  shipment: {
    shipmentId: null,
    statusCode: 'status_in_transit',
    statusCategory: 'transit',
    statusMilestone: 'out_for_delivery',
    originCountryCode: 'TH',
    destinationCountryCode: 'FR',
    delivery: {
      estimatedDeliveryDate: null,
      courierEstimatedDeliveryDate: { from: '2026-11-16T00:00:00Z', to: '2026-11-18T00:00:00Z' },
      service: null,
    },
  },
  events: [
    { eventId: 'a', status: 'Departed from Bangkok', occurrenceDatetime: '2026-11-10T08:00:00', location: 'Bangkok, TH', courierCode: 'thailand-post', statusMilestone: 'in_transit' },
    { eventId: 'b', status: 'Out for delivery', occurrenceDatetime: '2026-11-14T06:30:00+01:00', location: 'Lyon, FR', courierCode: 'la-poste-colissimo', statusMilestone: 'out_for_delivery' },
    { eventId: 'c', status: 'Created', occurrenceDatetime: '2026-11-09T01:00:00Z', location: null, courierCode: 'thailand-post', statusMilestone: 'pending' },
  ],
};

describe('Ship24 provider', () => {
  it('creates the tracker with the bearer key and normalizes the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { trackings: [tracking] } }));
    const result = await new Ship24Provider('KEY', fetchMock as unknown as typeof fetch).register({
      trackingNumber: 'RB123456789TH',
      postalCode: '69330',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.ship24.com/public/v1/trackers/track');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer KEY');
    expect(JSON.parse(init.body)).toEqual({ trackingNumber: 'RB123456789TH', destinationPostCode: '69330' });

    expect(result.status).toBe('out_for_delivery');
    expect(result.providerRef).toBe('trk_123');
    expect(result.carrierName).toBe('Thailand Post');
    expect(result.origin).toBe('TH');
    expect(result.destination).toBe('FR');
    expect(result.eta).toBe('2026-11-18T00:00:00.000Z');
    expect(result.statusText).toBe('Out for delivery');
    expect(result.events.map((e) => e.description)).toEqual(['Out for delivery', 'Departed from Bangkok', 'Created']);
    expect(result.events[0]!.status).toBe('out_for_delivery');
    expect(result.events[2]!.status).toBeNull(); // "pending" milestone carries no information
  });

  it('refreshes by tracker id without creating another tracker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { trackings: [tracking] } }));
    const ship24 = new Ship24Provider('KEY', fetchMock as unknown as typeof fetch);
    await ship24.refresh({ trackingNumber: 'RB123456789TH', providerRef: 'trk_123' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.ship24.com/public/v1/trackers/trk_123/results');
    expect(init.method).toBe('GET');
  });

  it('treats a tracker without data yet as unknown', () => {
    const fresh = parseTracking({
      tracker: { trackerId: 't', courierCode: [] },
      shipment: { statusMilestone: 'pending' },
      events: [],
    });
    expect(fresh.status).toBe('unknown');
    expect(fresh.events).toEqual([]);
    expect(fresh.carrierName).toBeNull();
  });

  it('reports bad keys, quota/validation errors and rate limits', async () => {
    const make = (r: Response) => new Ship24Provider('KEY', vi.fn().mockResolvedValue(r) as unknown as typeof fetch);
    await expect(make(json({}, 401)).register({ trackingNumber: 'X12345' })).rejects.toMatchObject({
      message: 'Ship24 rejected the API key',
      retryable: false,
    });
    await expect(
      make(json({ errors: [{ code: 'quota', message: 'Monthly shipments limit reached' }] }, 403)).register({ trackingNumber: 'X12345' }),
    ).rejects.toMatchObject({ message: 'Monthly shipments limit reached', retryable: false });
    await expect(make(new Response('', { status: 429 })).register({ trackingNumber: 'X12345' })).rejects.toMatchObject({ retryable: true });
  });
});
