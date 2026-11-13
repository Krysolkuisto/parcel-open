import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { TrackingProvider, TrackingResult } from '../src/domain.js';
import { LaPosteProvider, parseShipment } from '../src/providers/laposte.js';
import { withMinInterval } from '../src/providers/throttle.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Shaped after the Suivi v2 structures used by open-source clients (shipment, timeline, event, contextData).
const colissimo = {
  lang: 'fr_FR',
  scope: 'open',
  returnCode: 200,
  shipment: {
    idShip: '6A12345678901',
    product: 'colissimo',
    isFinal: false,
    estimDate: '2026-11-16T00:00:00+01:00',
    timeline: [
      { id: 1, shortLabel: 'Pris en charge', status: true, type: 1 },
      { id: 2, shortLabel: "En cours d'acheminement", status: true, type: 1 },
      { id: 3, shortLabel: 'Arrivé sur le site de livraison', status: true, type: 1 },
      { id: 4, shortLabel: 'En cours de livraison', status: false, type: 1 },
      { id: 5, shortLabel: 'Livré', status: false, type: 1 },
    ],
    event: [
      { code: 'DR1', label: 'Le service Colissimo a été informé', date: '2026-11-12T09:00:00+01:00', order: 1 },
      { code: 'PC1', label: 'Votre colis a été pris en charge', date: '2026-11-13T17:30:00+01:00', order: 2 },
      { code: 'ET1', label: "Votre colis est arrivé sur notre site de distribution", date: '2026-11-14T06:10:00+01:00', order: 3 },
    ],
    contextData: { originCountry: 'FR', arrivalCountry: 'FR' },
  },
};

describe('La Poste provider', () => {
  it('calls Suivi v2 with the Okapi key and normalizes the shipment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(colissimo));
    const result = await new LaPosteProvider('K'.repeat(64), fetchMock as unknown as typeof fetch).register({ trackingNumber: '6A12345678901' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.laposte.fr/suivi/v2/idships/6A12345678901?lang=fr_FR');
    expect(init.headers['X-Okapi-Key']).toBe('K'.repeat(64));

    expect(result.carrierName).toBe('Colissimo');
    expect(result.origin).toBe('FR');
    expect(result.eta).toBe('2026-11-15T23:00:00.000Z');
    expect(result.statusText).toBe('Votre colis est arrivé sur notre site de distribution');
    // ET1 has no fixed meaning here: the timeline (step 3 reached) says it is still on its way.
    expect(result.status).toBe('in_transit');
    expect(result.events.map((e) => e.description)).toEqual([
      'Votre colis est arrivé sur notre site de distribution',
      'Votre colis a été pris en charge',
      'Le service Colissimo a été informé',
    ]);
    expect(result.events[2]!.status).toBe('pending');
  });

  it('maps delivered, pickup point and out-for-delivery events', () => {
    const one = (code: string, label: string, step = 2) =>
      parseShipment({
        product: 'colissimo',
        timeline: [{ id: step, status: true }],
        event: [{ code, label, date: '2026-11-14T10:00:00+01:00' }],
      }).status;
    expect(one('DI1', 'Votre colis a été livré')).toBe('delivered');
    expect(one('AG1', 'Votre colis est disponible en point de retrait')).toBe('available_for_pickup');
    expect(one('RE1', "Votre colis a été retourné à l'expéditeur")).toBe('exception');
    expect(one('ET2', 'Votre colis est en cours de livraison')).toBe('out_for_delivery');
  });

  it('keeps an unknown number (404) and reports key, API and rate-limit problems', async () => {
    const make = (r: Response) => new LaPosteProvider('KEY', vi.fn().mockResolvedValue(r) as unknown as typeof fetch);
    const n = { trackingNumber: '6A12345678901' };

    expect((await make(json({ returnCode: 404, returnMessage: 'Resource not found' }, 404)).refresh(n)).status).toBe('unknown');
    await expect(make(json({ returnCode: 401 }, 401)).refresh(n)).rejects.toMatchObject({ message: 'La Poste rejected the API key', retryable: false });
    await expect(make(json({ returnCode: 400, returnMessage: 'Bad request' }, 400)).refresh(n)).rejects.toMatchObject({ message: 'Bad request' });
    await expect(make(new Response('', { status: 429 })).refresh(n)).rejects.toMatchObject({ retryable: true });
  });

  it('only accepts La Poste shapes, and verify() tells a bad key from an unknown number', async () => {
    const fetchMock = vi.fn();
    const laposte = new LaPosteProvider('KEY', fetchMock as unknown as typeof fetch);
    expect(laposte.canTrack('6A12345678901')).toBe(true);
    expect(laposte.canTrack('RR123456789FR')).toBe(true);
    expect(laposte.canTrack('1Z14V4W16890664609')).toBe(false);
    await expect(laposte.refresh({ trackingNumber: '1Z14V4W16890664609' })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(new LaPosteProvider('ok', vi.fn().mockResolvedValue(json({}, 404)) as unknown as typeof fetch).verify()).resolves.toBeUndefined();
    await expect(new LaPosteProvider('bad', vi.fn().mockResolvedValue(json({}, 401)) as unknown as typeof fetch).verify()).rejects.toMatchObject({
      message: 'La Poste rejected the API key',
    });
  });

  it('is configured from LAPOSTE_API_KEY, after the other free carrier APIs', () => {
    const config = loadConfig({ API_TOKEN: 't', LAPOSTE_API_KEY: 'k', DHL_API_KEY: 'd', UPS_CLIENT_ID: 'a', UPS_CLIENT_SECRET: 'b' });
    expect(config.providers).toEqual(['dhl', 'ups', 'laposte']);
  });
});

describe('withMinInterval', () => {
  it('spaces calls out and keeps the provider behaviour', async () => {
    const times: number[] = [];
    const base: TrackingProvider = {
      name: 'slow',
      acceptsCarrier: () => false,
      canTrack: (n) => n.startsWith('A'),
      register: async () => result(),
      refresh: async () => {
        times.push(Date.now());
        return result();
      },
    };
    const result = (): TrackingResult => ({
      status: 'pending', statusText: null, carrierCode: null, carrierName: null, eta: null,
      origin: null, destination: null, events: [], providerRef: null,
    });
    const wrapped = withMinInterval(base, 60);

    await Promise.all([1, 2, 3].map(() => wrapped.refresh({ trackingNumber: 'A1' })));

    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(55);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(55);
    expect(wrapped.name).toBe('slow');
    expect(wrapped.canTrack?.('A9')).toBe(true);
    expect(wrapped.canTrack?.('B9')).toBe(false);
  });
});
