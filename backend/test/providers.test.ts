import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../src/domain.js';
import { AfterShipProvider } from '../src/providers/aftership.js';
import { MockProvider } from '../src/providers/mock.js';
import { Track17Provider } from '../src/providers/track17.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const t17Item = {
  number: '1Z14V4W16890664609',
  carrier: 100002,
  tag: 'InTransit',
  track_info: {
    latest_status: { status: 'InTransit', sub_status: 'InTransit_PickedUp', sub_status_descr: 'Picked up' },
    latest_event: { description: 'Departure Scan', time_iso: '2026-11-13T13:55:00+01:00' },
    time_metrics: { estimated_delivery_date: { source: 'Carrier', from: '2026-11-16T00:00:00Z', to: '2026-11-17T00:00:00Z' } },
    shipping_info: {
      shipper_address: { country: 'FR', city: 'Corbeil' },
      recipient_address: { country: 'CN', city: 'Linhai' },
    },
    tracking: {
      providers: [
        {
          provider: { key: 100002, name: 'UPS' },
          events: [
            { time_iso: '2026-11-13T05:09:00+01:00', description: 'Origin Scan', location: 'Corbeil Essonnes, FR', stage: 'PickedUp' },
            { time_iso: '2026-11-13T13:55:00+01:00', description: 'Departure Scan', location: 'Meyzieu, FR', stage: 'Departure' },
            { time_iso: '2026-11-13T11:19:00+01:00', description: 'Arrival Scan', location: 'Meyzieu, FR', stage: 'Arrival' },
          ],
        },
      ],
    },
  },
};

describe('17TRACK provider', () => {
  it('registers then reads tracking info, normalizing the result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [{ number: t17Item.number, carrier: 100002 }], rejected: [] } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [t17Item], rejected: [] } }));
    const p = new Track17Provider('KEY', fetchMock as unknown as typeof fetch);

    const result = await p.register({ trackingNumber: t17Item.number });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.17track.net/track/v2.4/register');
    expect(fetchMock.mock.calls[0]![1].headers['17token']).toBe('KEY');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.17track.net/track/v2.4/gettrackinfo');
    expect(result.status).toBe('in_transit');
    expect(result.carrierName).toBe('UPS');
    expect(result.carrierCode).toBe('100002');
    expect(result.eta).toBe('2026-11-17T00:00:00.000Z');
    expect(result.origin).toBe('Corbeil, FR');
    expect(result.events.map((e) => e.description)).toEqual(['Departure Scan', 'Arrival Scan', 'Origin Scan']);
    expect(result.events[0]!.status).toBe('in_transit');
  });

  it('treats "already registered" as success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [], rejected: [{ number: 'X', error: { code: -18019901, message: 'registered' } }] } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [t17Item], rejected: [] } }));
    const p = new Track17Provider('KEY', fetchMock as unknown as typeof fetch);
    await expect(p.register({ trackingNumber: 'X12345' })).resolves.toMatchObject({ status: 'in_transit' });
  });

  it('registers on the fly when gettrackinfo says the number is unknown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [], rejected: [{ number: 'X', error: { code: -18019902, message: 'not registered' } }] } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [{ number: 'X' }], rejected: [] } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { accepted: [t17Item], rejected: [] } }));
    const p = new Track17Provider('KEY', fetchMock as unknown as typeof fetch);
    await expect(p.refresh({ trackingNumber: 'X12345' })).resolves.toMatchObject({ status: 'in_transit' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('turns an invalid number into a non-retryable error and 429 into a retryable one', async () => {
    const bad = vi.fn().mockResolvedValue(
      jsonResponse({ code: 0, data: { accepted: [], rejected: [{ number: 'X', error: { code: -18010012, message: 'format invalid' } }] } }),
    );
    await expect(new Track17Provider('K', bad as unknown as typeof fetch).register({ trackingNumber: 'X12345' })).rejects.toMatchObject({
      retryable: false,
      message: 'format invalid',
    });

    const limited = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(new Track17Provider('K', limited as unknown as typeof fetch).refresh({ trackingNumber: 'X12345' })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('verifies webhook signatures (sha256 of body + "/" + key)', () => {
    const p = new Track17Provider('SECRETKEY');
    const body = JSON.stringify({ event: 'TRACKING_UPDATED', data: t17Item });
    const sign = createHash('sha256').update(`${body}/SECRETKEY`).digest('hex');
    expect(p.webhook.verify({ sign }, body)).toBe(true);
    expect(p.webhook.verify({ sign: 'deadbeef' }, body)).toBe(false);
    expect(p.webhook.verify({}, body)).toBe(false);
    const parsed = p.webhook.parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.trackingNumber).toBe(t17Item.number);
    expect(parsed[0]!.result.status).toBe('in_transit');
  });
});

const asTracking = {
  id: 'abc123',
  tracking_number: '9400111899223',
  slug: 'usps',
  tag: 'OutForDelivery',
  subtag_message: 'Out for delivery',
  destination_city: 'Lyon',
  destination_country_region: 'FRA',
  aftership_estimated_delivery_date: { estimated_delivery_date: '2026-11-14T12:00:00Z' },
  checkpoints: [
    { checkpoint_time: '2026-11-13T08:00:00Z', message: 'Arrived at facility', tag: 'InTransit', city: 'Paris' },
    { checkpoint_time: '2026-11-14T06:00:00Z', message: 'Out for delivery', tag: 'OutForDelivery', location: 'Lyon' },
  ],
};

describe('AfterShip provider', () => {
  it('creates a tracking and normalizes it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ meta: { code: 201 }, data: asTracking }, 201));
    const p = new AfterShipProvider('KEY', 'SECRET', fetchMock as unknown as typeof fetch);
    const result = await p.register({ trackingNumber: '9400111899223', carrierCode: 'usps' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.aftership.com/tracking/2025-07/trackings');
    expect(init.headers['as-api-key']).toBe('KEY');
    expect(JSON.parse(init.body)).toEqual({ tracking_number: '9400111899223', slug: 'usps' });
    expect(result.status).toBe('out_for_delivery');
    expect(result.providerRef).toBe('abc123');
    expect(result.eta).toBe('2026-11-14T12:00:00.000Z');
    expect(result.events[0]!.description).toBe('Out for delivery');
    expect(result.destination).toBe('Lyon, FRA');
  });

  it('falls back to a lookup when the tracking already exists (409)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { code: 4003, message: 'exists' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ meta: { code: 200 }, data: { trackings: [asTracking] } }));
    const p = new AfterShipProvider('KEY', null, fetchMock as unknown as typeof fetch);
    const result = await p.register({ trackingNumber: '9400111899223' });
    expect(fetchMock.mock.calls[1]![0]).toContain('/trackings?tracking_numbers=9400111899223');
    expect(result.status).toBe('out_for_delivery');
  });

  it('refreshes by provider id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ meta: { code: 200 }, data: asTracking }));
    const p = new AfterShipProvider('KEY', null, fetchMock as unknown as typeof fetch);
    await p.refresh({ trackingNumber: '9400111899223', providerRef: 'abc123' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.aftership.com/tracking/2025-07/trackings/abc123');
  });

  it('surfaces API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ meta: { code: 4005, message: 'Invalid tracking number' } }, 400));
    const p = new AfterShipProvider('KEY', null, fetchMock as unknown as typeof fetch);
    await expect(p.register({ trackingNumber: 'bad' })).rejects.toBeInstanceOf(ProviderError);
  });

  it('verifies webhook HMAC signatures', () => {
    const p = new AfterShipProvider('KEY', 'SECRET');
    const body = JSON.stringify({ event: 'tracking_update', data: { tracking: asTracking } });
    const sig = createHmac('sha256', 'SECRET').update(body).digest('base64');
    expect(p.webhook.verify({ 'aftership-hmac-sha256': sig }, body)).toBe(true);
    expect(p.webhook.verify({ 'aftership-hmac-sha256': 'nope' }, body)).toBe(false);
    expect(new AfterShipProvider('KEY', null).webhook.verify({ 'aftership-hmac-sha256': sig }, body)).toBe(false);
    expect(p.webhook.parse(body)[0]!.result.status).toBe('out_for_delivery');
  });
});

describe('Mock provider', () => {
  it('is deterministic per tracking number', async () => {
    const m = new MockProvider(() => Date.parse('2026-11-13T12:00:00Z'));
    expect((await m.register({ trackingNumber: 'AB10' })).status).toBe('delivered');
    expect((await m.register({ trackingNumber: 'AB11' })).status).toBe('out_for_delivery');
    expect((await m.register({ trackingNumber: 'AB19' })).status).toBe('in_transit');
    const events = (await m.register({ trackingNumber: 'AB10' })).events;
    expect(events[0]!.time >= events[1]!.time).toBe(true);
  });
});
