import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDhlNumber } from '../src/carriers.js';
import { ProviderError } from '../src/domain.js';
import { DhlProvider, mapDhlStatus } from '../src/providers/dhl.js';
import { MockProvider } from '../src/providers/mock.js';
import { buildServer } from '../src/server.js';
import { TrackingService } from '../src/service.js';
import { Store } from '../src/store.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Trimmed from the real response of DHL's public demo key (api-eu.dhl.com/track/shipments).
const demoShipment = {
  shipments: [
    {
      id: '00340434292135100186',
      service: 'ecommerce',
      origin: { address: { countryCode: 'US', postalCode: '41048', addressLocality: 'HEBRON' } },
      destination: { address: { countryCode: 'US', postalCode: '89014', addressLocality: 'HENDERSON' } },
      status: {
        timestamp: '2023-05-08T10:37:00',
        location: { address: { countryCode: 'US', addressLocality: 'Henderson, NV, US' } },
        statusCode: 'delivered',
        status: 'DELIVERED',
        description: 'DELIVERED - PARCEL LOCKER',
      },
      events: [
        {
          timestamp: '2023-05-08T10:37:00',
          location: { address: { countryCode: 'US', addressLocality: 'Henderson, NV, US' } },
          statusCode: 'delivered',
          status: 'DELIVERED',
          description: 'DELIVERED - PARCEL LOCKER',
        },
        {
          timestamp: '2023-05-08T06:10:00',
          location: { address: { countryCode: 'US', addressLocality: 'Henderson, NV, US' } },
          statusCode: 'transit',
          status: 'OUT FOR DELIVERY',
        },
        {
          timestamp: '2023-05-06T04:18:30',
          location: { address: { countryCode: 'US', addressLocality: 'Whittier, CA, US' } },
          statusCode: 'pre-transit',
          status: 'SHIPPING LABEL CREATED',
        },
      ],
    },
  ],
};

describe('DHL provider', () => {
  it('queries the tracking API with the key and normalizes the shipment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(demoShipment));
    const dhl = new DhlProvider('KEY', fetchMock as unknown as typeof fetch);

    const result = await dhl.register({ trackingNumber: '00340434292135100186' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186&language=en');
    expect(init.headers['DHL-API-Key']).toBe('KEY');
    expect(result.status).toBe('delivered');
    expect(result.statusText).toBe('DELIVERED - PARCEL LOCKER');
    expect(result.carrierName).toBe('DHL eCommerce');
    expect(result.origin).toBe('HEBRON, US');
    expect(result.destination).toBe('HENDERSON, US');
    expect(result.events.map((e) => e.status)).toEqual(['delivered', 'out_for_delivery', 'pending']);
    expect(result.events[0]!.location).toBe('Henderson, NV, US');
    expect(result.events[0]!.time >= result.events[2]!.time).toBe(true);
  });

  it('maps DHL status codes, using the text to refine "transit"', () => {
    expect(mapDhlStatus('pre-transit', null)).toBe('pending');
    expect(mapDhlStatus('transit', 'ARRIVED AT SORT FACILITY')).toBe('in_transit');
    expect(mapDhlStatus('transit', 'Die Sendung wird in Zustellung gebracht')).toBe('out_for_delivery');
    expect(mapDhlStatus('transit', 'Ready for pickup at Packstation')).toBe('available_for_pickup');
    expect(mapDhlStatus('failure', null)).toBe('failed_attempt');
    expect(mapDhlStatus('delivered', null)).toBe('delivered');
    expect(mapDhlStatus('something-new', null)).toBe('unknown');
    expect(mapDhlStatus(null, null)).toBe('unknown');
  });

  it('keeps an announced-but-unscanned parcel (404) instead of rejecting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 404, title: 'No result found' }, 404));
    const result = await new DhlProvider('KEY', fetchMock as unknown as typeof fetch).refresh({ trackingNumber: 'CP044239925DE' });
    expect(result.status).toBe('unknown');
    expect(result.events).toEqual([]);
  });

  it('reports a bad key, a bad request and rate limiting distinctly', async () => {
    const make = (response: Response) => new DhlProvider('KEY', vi.fn().mockResolvedValue(response) as unknown as typeof fetch);

    await expect(make(json({ status: 401, title: 'Unauthorized' }, 401)).refresh({ trackingNumber: 'CP044239925DE' })).rejects.toMatchObject({
      retryable: false,
      message: 'DHL rejected the API key',
    });
    await expect(
      make(json({ status: 400, title: 'Bad Request', detail: 'Invalid tracking number' }, 400)).refresh({ trackingNumber: 'CP044239925DE' }),
    ).rejects.toMatchObject({ retryable: false, message: 'Invalid tracking number' });
    await expect(make(new Response('', { status: 429 })).refresh({ trackingNumber: 'CP044239925DE' })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('refuses numbers that are not DHL shapes without calling the API', async () => {
    const fetchMock = vi.fn();
    const dhl = new DhlProvider('KEY', fetchMock as unknown as typeof fetch);
    await expect(dhl.refresh({ trackingNumber: '1Z14V4W16890664609' })).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recognizes DHL number shapes', () => {
    for (const n of ['CP044239925DE', '00340434292135100186', '1234567890', 'JJD0099999999', 'GM6061234567890123', 'RR123456789DE']) {
      expect(isDhlNumber(n), n).toBe(true);
    }
    for (const n of ['1Z14V4W16890664609', 'RR123456789FR', '9400111899223452345678', 'ABC']) {
      expect(isDhlNumber(n), n).toBe(false);
    }
  });
});

describe('service with a carrier-specific provider', () => {
  let store: Store;
  afterEach(() => store?.close());

  const setup = (providers: ConstructorParameters<typeof TrackingService>[1]) => {
    store = new Store(':memory:');
    const service = new TrackingService(store, providers);
    return buildServer({ service, apiToken: 'tok' });
  };
  const add = (app: ReturnType<typeof setup>, trackingNumber: string) =>
    app.inject({ method: 'POST', url: '/v1/packages', headers: { authorization: 'Bearer tok' }, payload: { trackingNumber } });

  it('rejects a number no configured provider can handle, and stores nothing', async () => {
    const dhl = new DhlProvider('KEY', vi.fn() as unknown as typeof fetch);
    const app = setup([dhl]);
    const res = await add(app, '1Z14V4W16890664609');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('No configured tracking provider');
    expect((await app.inject({ url: '/v1/packages', headers: { authorization: 'Bearer tok' } })).json().packages).toHaveLength(0);
    await app.close();
  });

  it('routes each number to a provider that can handle it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(demoShipment));
    const dhl = new DhlProvider('KEY', fetchMock as unknown as typeof fetch);
    const app = setup([dhl, new MockProvider()]);

    const dhlPkg = (await add(app, '00340434292135100186')).json().package;
    expect(dhlPkg).toMatchObject({ provider: 'dhl', status: 'delivered', carrierName: 'DHL eCommerce' });

    const other = (await add(app, '1Z14V4W16890664619')).json().package;
    expect(other.provider).toBe('mock'); // DHL skipped, the next provider took it
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
