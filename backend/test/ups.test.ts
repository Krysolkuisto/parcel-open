import { describe, expect, it, vi } from 'vitest';
import { UpsProvider, mapUpsStatus, parsePackage } from '../src/providers/ups.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = (expiresIn = '14399') => json({ token_type: 'Bearer', access_token: 'TOK', expires_in: expiresIn, status: 'approved' });

// Shaped after UPS's published Track API schema (trackResponse.shipment[].package[]).
const trackResponse = {
  trackResponse: {
    shipment: [
      {
        inquiryNumber: '1Z14V4W16890664609',
        package: [
          {
            trackingNumber: '1Z14V4W16890664609',
            deliveryDate: [{ type: 'SDD', date: '20261116' }],
            packageAddress: [
              { type: 'ORIGIN', address: { city: 'CORBEIL', countryCode: 'FR' } },
              { type: 'DESTINATION', address: { city: 'LYON', stateProvince: '', countryCode: 'FR' } },
            ],
            currentStatus: { description: 'Out For Delivery Today', code: '021', type: 'O' },
            activity: [
              {
                date: '20261114',
                time: '073000',
                gmtDate: '20261114',
                gmtTime: '06:30:00',
                gmtOffset: '+01:00',
                location: { address: { city: 'Lyon', countryCode: 'FR' } },
                status: { type: 'O', description: 'Out For Delivery Today', code: '021' },
              },
              {
                date: '20261113',
                time: '215500',
                gmtDate: '20261113',
                gmtTime: '20:55:00',
                gmtOffset: '+01:00',
                location: { address: { city: 'Meyzieu', stateProvince: '', countryCode: 'FR' } },
                status: { type: 'I', description: 'Departed from Facility', code: 'DP' },
              },
              {
                date: '20261112',
                time: '180000',
                gmtDate: '20261112',
                gmtTime: '17:00:00',
                location: { address: { city: 'Corbeil', countryCode: 'FR' } },
                status: { type: 'M', description: 'Shipper created a label, UPS has not received the package yet.', code: 'MP' },
              },
            ],
          },
        ],
      },
    ],
  },
};

describe('UPS provider', () => {
  it('signs in with client credentials, then reads the tracking details', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(json(trackResponse));
    const ups = new UpsProvider('CID', 'SECRET', fetchMock as unknown as typeof fetch);

    const result = await ups.register({ trackingNumber: '1Z14V4W16890664609' });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://onlinetools.ups.com/security/v1/oauth/token');
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from('CID:SECRET').toString('base64')}`);
    expect(tokenInit.body).toBe('grant_type=client_credentials');

    const [trackUrl, trackInit] = fetchMock.mock.calls[1]!;
    expect(String(trackUrl)).toBe('https://onlinetools.ups.com/api/track/v1/details/1Z14V4W16890664609?locale=en_US');
    expect(trackInit.headers.Authorization).toBe('Bearer TOK');
    expect(trackInit.headers.transId).toBeTruthy();
    expect(trackInit.headers.transactionSrc).toBe('parcel-open');

    expect(result.status).toBe('out_for_delivery');
    expect(result.statusText).toBe('Out For Delivery Today');
    expect(result.carrierName).toBe('UPS');
    expect(result.origin).toBe('CORBEIL, FR');
    expect(result.destination).toBe('LYON, FR');
    expect(result.eta).toBe(new Date('2026-11-16T12:00:00').toISOString()); // noon local time of the expected day
    expect(result.events.map((e) => e.description)).toEqual([
      'Out For Delivery Today',
      'Departed from Facility',
      'Shipper created a label, UPS has not received the package yet.',
    ]);
    expect(result.events[0]!.time).toBe('2026-11-14T06:30:00.000Z'); // GMT fields win
    expect(result.events.map((e) => e.status)).toEqual(['out_for_delivery', 'in_transit', 'pending']);
    expect(result.events[1]!.location).toBe('Meyzieu, FR');
  });

  it('reuses the access token until it expires, and signs in again after', async () => {
    let now = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(token('300'))
      .mockImplementation(async () => json(trackResponse)); // a fresh Response each time
    const ups = new UpsProvider('CID', 'SECRET', fetchMock as unknown as typeof fetch, () => now);

    await ups.refresh({ trackingNumber: '1Z14V4W16890664609' });
    await ups.refresh({ trackingNumber: '1Z14V4W16890664609' });
    const signIns = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token')).length;
    expect(signIns()).toBe(1);

    now += 10 * 60_000; // past the token lifetime
    fetchMock.mockResolvedValueOnce(token()); // next call is the new sign-in
    await ups.refresh({ trackingNumber: '1Z14V4W16890664609' });
    expect(signIns()).toBe(2);
  });

  it('signs in again once when UPS answers 401 to a cached token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ response: { errors: [{ code: '250002', message: 'Invalid Authentication Information' }] } }, 401))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json(trackResponse));
    const result = await new UpsProvider('CID', 'SECRET', fetchMock as unknown as typeof fetch).refresh({ trackingNumber: '1Z14V4W16890664609' });
    expect(result.status).toBe('out_for_delivery');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps a number UPS has not scanned yet (404 or warning without package)', async () => {
    const make = (...responses: Response[]) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(token());
      responses.forEach((r) => fetchMock.mockResolvedValueOnce(r));
      return new UpsProvider('CID', 'SECRET', fetchMock as unknown as typeof fetch);
    };
    const notFound = await make(json({ response: { errors: [{ code: '151044', message: 'No tracking information available' }] } }, 404)).refresh({
      trackingNumber: '1Z14V4W16890664609',
    });
    expect(notFound.status).toBe('unknown');

    const warning = await make(json({ trackResponse: { shipment: [{ inquiryNumber: 'x', warnings: [{ code: 'TW0001', message: 'Tracking Information Not Found' }] }] } })).refresh({
      trackingNumber: '1Z14V4W16890664609',
    });
    expect(warning).toMatchObject({ status: 'unknown', events: [] });
  });

  it('reports bad credentials, API errors and rate limits distinctly', async () => {
    const badSecret = new UpsProvider('CID', 'nope', vi.fn().mockResolvedValue(json({}, 401)) as unknown as typeof fetch);
    await expect(badSecret.refresh({ trackingNumber: '1Z14V4W16890664609' })).rejects.toMatchObject({
      message: 'UPS rejected the client id or secret',
      retryable: false,
    });

    const apiError = new UpsProvider(
      'CID',
      'S',
      vi
        .fn()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(json({ response: { errors: [{ code: '151018', message: 'Invalid inquiry number' }] } }, 400)) as unknown as typeof fetch,
    );
    await expect(apiError.refresh({ trackingNumber: '1Z14V4W16890664609' })).rejects.toMatchObject({ message: 'Invalid inquiry number', retryable: false });

    const limited = new UpsProvider('CID', 'S', vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('', { status: 429 })) as unknown as typeof fetch);
    await expect(limited.refresh({ trackingNumber: '1Z14V4W16890664609' })).rejects.toMatchObject({ retryable: true });
  });

  it('refuses non-UPS numbers without any request', async () => {
    const fetchMock = vi.fn();
    await expect(new UpsProvider('CID', 'S', fetchMock as unknown as typeof fetch).refresh({ trackingNumber: 'CP044239925DE' })).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps UPS activity types, using the text to refine them', () => {
    expect(mapUpsStatus('D', 'Delivered')).toBe('delivered');
    expect(mapUpsStatus('O', 'Out For Delivery Today')).toBe('out_for_delivery');
    expect(mapUpsStatus('M', 'Label created')).toBe('pending');
    expect(mapUpsStatus('I', 'Arrived at Facility')).toBe('in_transit');
    expect(mapUpsStatus('P', 'Pickup Scan')).toBe('in_transit');
    expect(mapUpsStatus('I', 'Ready for pick up at UPS Access Point')).toBe('available_for_pickup');
    expect(mapUpsStatus('X', 'Delivery attempted; the receiver was not available')).toBe('failed_attempt');
    expect(mapUpsStatus('X', 'Package damaged')).toBe('exception');
    expect(mapUpsStatus('RS', 'Returned to sender')).toBe('exception');
    expect(mapUpsStatus('??', 'whatever')).toBe('unknown');
  });

  it('reads a delivered package', () => {
    const result = parsePackage({
      currentStatus: { description: 'Delivered', type: 'D' },
      deliveryDate: [{ type: 'DEL', date: '20261115' }],
      activity: [{ gmtDate: '20261115', gmtTime: '10:00:00', location: { address: { city: 'Lyon', countryCode: 'FR' } }, status: { type: 'D', description: 'Delivered' } }],
    });
    expect(result.status).toBe('delivered');
    expect(result.eta).toBeNull(); // a DEL date is the delivery itself, not an estimate
  });
});
