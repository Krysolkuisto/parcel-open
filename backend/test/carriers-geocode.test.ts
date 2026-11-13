import { afterEach, describe, expect, it, vi } from 'vitest';
import { carrierDisplayName, detectCarrier, trackingUrl } from '../src/carriers.js';
import { NominatimGeocoder, queries, type Geocoder } from '../src/geocode.js';
import { MockProvider } from '../src/providers/mock.js';
import { buildServer } from '../src/server.js';
import { TrackingService } from '../src/service.js';
import { Store } from '../src/store.js';

describe('carrier detection', () => {
  it.each([
    ['1Z14V4W16890664609', 'UPS'],
    ['1z14 v4w1 6890 6646 09', 'UPS'],
    ['TBA123456789012', 'Amazon Logistics'],
    ['9400111899223452345678', 'USPS'],
    ['RR123456789FR', 'La Poste'],
    ['LZ123456789GB', 'Royal Mail'],
    ['EE123456789CN', 'China Post'],
    ['RB123456789TH', 'Thailand Post'],
    ['EJ123456789JP', 'Japan Post'],
    ['CX123456789KR', 'Korea Post'],
    ['CP044239925DE', 'DHL Paket'],
    ['6A12345678901', 'Colissimo'],
    ['JJD0099999999', 'DHL'],
    ['YT2012345678901234', 'YunExpress'],
    ['123456789012', 'FedEx'],
    ['1234567890', 'DHL'],
  ])('%s is %s', (number, name) => {
    expect(detectCarrier(number)?.name).toBe(name);
  });

  it('stays silent when unsure', () => {
    expect(detectCarrier('ABCDE')).toBeNull();
    expect(detectCarrier('7700123456782')).toBeNull();
    expect(detectCarrier('RR123456789ZZ')).toBeNull();
  });

  it('turns provider slugs into display names', () => {
    expect(carrierDisplayName('usps')).toBe('USPS');
    expect(carrierDisplayName('la-poste-colissimo')).toBe('Colissimo');
    expect(carrierDisplayName('some-new-carrier')).toBe('Some New Carrier');
    expect(carrierDisplayName('thailand-post')).toBe('Thailand Post');
    expect(carrierDisplayName('deutsche-post-dhl')).toBe('Deutsche Post DHL');
  });
});

describe('tracking links', () => {
  it('links to the carrier site when it accepts the number, else to 17TRACK', () => {
    expect(trackingUrl('1Z14V4W16890664609')).toBe('https://www.ups.com/track?tracknum=1Z14V4W16890664609');
    expect(trackingUrl('rb123456789th')).toBe('https://track.thailandpost.co.th/?trackNumber=RB123456789TH');
    expect(trackingUrl('EJ123456789JP')).toContain('japanpost.jp');
    expect(trackingUrl('CP044239925DE')).toContain('dhl.com');
    expect(trackingUrl('6A12345678901')).toContain('laposte.fr');
    // China Post and Amazon have no usable public link: universal page
    expect(trackingUrl('EE123456789CN')).toBe('https://parcelsapp.com/en/tracking/EE123456789CN');
    expect(trackingUrl('TBA123456789012')).toBe('https://parcelsapp.com/en/tracking/TBA123456789012');
    expect(trackingUrl('unknownformat1')).toBe('https://parcelsapp.com/en/tracking/UNKNOWNFORMAT1');
  });
});

describe('geocoder', () => {
  let store: Store;
  afterEach(() => store?.close());

  const make = (fetchImpl: typeof fetch) => {
    store = new Store(':memory:');
    return new NominatimGeocoder(store, {
      baseUrl: 'https://geo.test',
      userAgent: 'Test/1.0',
      minIntervalMs: 0,
      fetchImpl,
    });
  };
  const hit = (lat: string, lon: string) => new Response(JSON.stringify([{ lat, lon }]));
  const miss = () => new Response('[]');

  it('builds simpler fallback queries for facility names', () => {
    expect(queries('Meyzieu Jonage, France')).toEqual(['Meyzieu Jonage, France', 'Meyzieu, France']);
    expect(queries('Lyon, France')).toEqual(['Lyon, France']);
    expect(queries('Saint-Rambert-D\'albon, France')).toEqual(["Saint-Rambert-D'albon, France", 'Saint, France']);
  });

  it('looks a place up once, sends an identifying user agent, then serves it from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(hit('45.76', '4.83'));
    const geo = make(fetchMock as unknown as typeof fetch);

    expect(await geo.locate('Lyon, France')).toEqual({ lat: 45.76, lon: 4.83 });
    expect(await geo.locate('  LYON, france ')).toEqual({ lat: 45.76, lon: 4.83 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://geo.test/search?q=Lyon%2C+France&format=jsonv2&limit=1');
    expect(init.headers['User-Agent']).toBe('Test/1.0');
  });

  it('falls back to the town name, and remembers real misses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(miss()).mockResolvedValueOnce(hit('45.77', '5.0'));
    const geo = make(fetchMock as unknown as typeof fetch);
    expect(await geo.locate('Meyzieu Jonage, France')).toEqual({ lat: 45.77, lon: 5.0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const nothing = vi.fn().mockResolvedValue(miss());
    const geo2 = make(nothing as unknown as typeof fetch);
    expect(await geo2.locate('Nowhere')).toBeNull();
    expect(await geo2.locate('Nowhere')).toBeNull();
    expect(nothing).toHaveBeenCalledTimes(1); // second call answered by the negative cache
  });

  it('does not remember a miss caused by a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(hit('1', '2'));
    const geo = make(fetchMock as unknown as typeof fetch);
    expect(await geo.locate('Lyon, France')).toBeNull();
    expect(await geo.locate('Lyon, France')).toEqual({ lat: 1, lon: 2 });
  });
});

describe('API: position and carrier', () => {
  const fakeGeocoder: Geocoder = {
    locate: async (place) => (place.startsWith('Lyon') ? { lat: 45.76, lon: 4.83 } : null),
  };

  const setup = () => {
    const store = new Store(':memory:');
    const service = new TrackingService(store, [new MockProvider()], { refreshSpacingMs: 0, geocoder: fakeGeocoder });
    const app = buildServer({ service, apiToken: 'tok' });
    return { store, app };
  };
  const auth = { authorization: 'Bearer tok' };

  it('returns the geocoded position of the latest place on a single package', async () => {
    const { store, app } = setup();
    const created = await app.inject({ method: 'POST', url: '/v1/packages', headers: auth, payload: { trackingNumber: '1Z14V4W16890664619' } });
    const id = created.json().package.id as string;
    // mock scenario 9 (in transit) ends in Lyon
    const detail = (await app.inject({ url: `/v1/packages/${id}`, headers: auth })).json().package;
    expect(detail.position).toEqual({ lat: 45.76, lon: 4.83, place: 'Lyon, France' });
    expect(detail.carrierName).toBe('UPS');
    await app.close();
    store.close();
  });

  it('has no position when the place cannot be found', async () => {
    const { store, app } = setup();
    const id = (await app.inject({ method: 'POST', url: '/v1/packages', headers: auth, payload: { trackingNumber: 'ABCDE1' } })).json().package.id;
    const detail = (await app.inject({ url: `/v1/packages/${id}`, headers: auth })).json().package;
    expect(detail.position).toBeNull(); // out for delivery: Meyzieu is unknown to the fake geocoder
    await app.close();
    store.close();
  });

  it('detects a carrier before the package is added', async () => {
    const { store, app } = setup();
    const res = await app.inject({ url: '/v1/carriers/detect?number=1Z14V4W16890664609', headers: auth });
    expect(res.json()).toEqual({ carrier: { code: 'ups', name: 'UPS' } });
    expect((await app.inject({ url: '/v1/carriers/detect?number=ZZZ', headers: auth })).json()).toEqual({ carrier: null });
    expect((await app.inject({ url: '/v1/carriers/detect' , headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/carriers/detect?number=1Z14V4W16890664609' })).statusCode).toBe(401);
    await app.close();
    store.close();
  });
});
