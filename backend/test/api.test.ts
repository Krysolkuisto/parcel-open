import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError, type TrackInput, type TrackingProvider, type TrackingResult } from '../src/domain.js';
import { MockProvider } from '../src/providers/mock.js';
import { Track17Provider } from '../src/providers/track17.js';
import { buildServer } from '../src/server.js';
import { TrackingService, type StatusChange } from '../src/service.js';
import { Store } from '../src/store.js';

const AUTH = { authorization: 'Bearer test-token' };

let app: FastifyInstance;
let service: TrackingService;
let store: Store;

function setup(providers: TrackingProvider[] = [new MockProvider()]) {
  store = new Store(':memory:');
  service = new TrackingService(store, providers);
  app = buildServer({ service, apiToken: 'test-token' });
}

async function add(trackingNumber: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/v1/packages', headers: AUTH, payload: { trackingNumber, ...extra } });
  return res;
}

describe('API', () => {
  beforeEach(() => setup());
  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('serves /health without auth and rejects API calls without a token', async () => {
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/packages' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/packages', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
  });

  it('adds a package, normalizing the number and storing events', async () => {
    const res = await add('ab 12-34 56 1', { label: '1st pack', description: 'Shoes' });
    expect(res.statusCode).toBe(201);
    const pkg = res.json().package;
    expect(pkg).toMatchObject({
      trackingNumber: 'AB1234561',
      label: '1st pack',
      description: 'Shoes',
      status: 'out_for_delivery',
      carrierName: 'Mock Carrier',
    });
    expect(pkg.lastEvent.description).toBe('Out for delivery');

    const detail = (await app.inject({ url: `/v1/packages/${pkg.id}`, headers: AUTH })).json().package;
    expect(detail.events.length).toBeGreaterThan(3);
  });

  it('validates input and rejects duplicates', async () => {
    expect((await add('')).statusCode).toBe(400);
    expect((await add('a b')).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/v1/packages', headers: { ...AUTH, 'content-type': 'application/json' }, payload: '{oops' })).statusCode).toBe(400);
    expect((await add('DUP123450')).statusCode).toBe(201);
    const dup = await add('dup 12345 0');
    expect(dup.statusCode).toBe(409);
  });

  it('lists packages with attention-needing ones first, hides archived, and patches', async () => {
    const delivered = (await add('AAAAA0', { label: 'delivered' })).json().package;
    const transit = (await add('AAAAA9', { label: 'transit' })).json().package;
    const out = (await add('AAAAA1', { label: 'out' })).json().package;

    const list = (await app.inject({ url: '/v1/packages', headers: AUTH })).json().packages;
    expect(list.map((p: { label: string }) => p.label)).toEqual(['out', 'transit', 'delivered']);
    expect(list[2].deliveredAt).not.toBeNull();

    const patched = await app.inject({ method: 'PATCH', url: `/v1/packages/${delivered.id}`, headers: AUTH, payload: { archived: true, label: ' renamed ' } });
    expect(patched.json().package).toMatchObject({ archived: true, label: 'renamed' });
    expect((await app.inject({ url: '/v1/packages', headers: AUTH })).json().packages).toHaveLength(2);
    expect((await app.inject({ url: '/v1/packages?archived=true', headers: AUTH })).json().packages).toHaveLength(3);
    void transit;
    void out;
  });

  it('refreshes one package, all packages, and deletes', async () => {
    const pkg = (await add('BBBBB9')).json().package;
    const one = await app.inject({ method: 'POST', url: `/v1/packages/${pkg.id}/refresh`, headers: AUTH });
    expect(one.json().package.lastCheckedAt).not.toBeNull();

    const all = await app.inject({ method: 'POST', url: '/v1/refresh', headers: AUTH });
    expect(all.json()).toEqual({ refreshed: 1, failed: 0, skipped: false });

    expect((await app.inject({ method: 'DELETE', url: `/v1/packages/${pkg.id}`, headers: AUTH })).statusCode).toBe(204);
    expect((await app.inject({ url: `/v1/packages/${pkg.id}`, headers: AUTH })).statusCode).toBe(404);
  });

  it('exposes a compact widget feed of active packages', async () => {
    await add('CCCCC0', { label: 'done' });
    await add('CCCCC1', { label: 'arriving' });
    await add('CCCCC9', { label: 'moving' });
    const w = (await app.inject({ url: '/v1/widget?limit=1', headers: AUTH })).json();
    expect(w.activeCount).toBe(2);
    expect(w.outForDeliveryCount).toBe(1);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]).toMatchObject({ title: 'arriving', status: 'out_for_delivery' });
  });
});

describe('service behaviour', () => {
  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('keeps the package when the provider is temporarily down, and recovers on refresh', async () => {
    let down = true;
    const flaky: TrackingProvider = {
      name: 'flaky',
      acceptsCarrier: () => false,
      async register(i: TrackInput): Promise<TrackingResult> {
        return this.refresh(i);
      },
      async refresh(i: TrackInput): Promise<TrackingResult> {
        if (down) throw new ProviderError('timeout', true);
        return new MockProvider().refresh(i);
      },
    };
    setup([flaky]);

    const res = await add('DDDDD1');
    expect(res.statusCode).toBe(201);
    expect(res.json().package).toMatchObject({ status: 'unknown', lastError: 'timeout' });

    down = false;
    const id = res.json().package.id as string;
    const refreshed = (await app.inject({ method: 'POST', url: `/v1/packages/${id}/refresh`, headers: AUTH })).json().package;
    expect(refreshed).toMatchObject({ status: 'out_for_delivery', lastError: null });
  });

  it('rejects numbers every provider refuses, without leaving a record behind', async () => {
    const strict: TrackingProvider = {
      name: 'strict',
      acceptsCarrier: () => false,
      register: async () => {
        throw new ProviderError('format invalid', false);
      },
      refresh: async () => {
        throw new ProviderError('format invalid', false);
      },
    };
    setup([strict]);
    const res = await add('EEEEE1');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe('format invalid');
    expect((await app.inject({ url: '/v1/packages', headers: AUTH })).json().packages).toHaveLength(0);
  });

  it('falls back to the next provider', async () => {
    const strict: TrackingProvider = {
      name: 'strict',
      acceptsCarrier: () => false,
      register: async () => {
        throw new ProviderError('unsupported carrier', false);
      },
      refresh: async () => {
        throw new ProviderError('unsupported carrier', false);
      },
    };
    setup([strict, new MockProvider()]);
    const res = await add('FFFFF1');
    expect(res.statusCode).toBe(201);
    expect(res.json().package.status).toBe('out_for_delivery');
  });

  it('emits statusChanged only when the status really changes, and never downgrades to unknown', async () => {
    let status: TrackingResult['status'] = 'in_transit';
    const scripted: TrackingProvider = {
      name: 'scripted',
      acceptsCarrier: () => false,
      register: async () => result(),
      refresh: async () => result(),
    };
    const result = (): TrackingResult => ({
      status,
      statusText: status,
      carrierCode: null,
      carrierName: null,
      eta: null,
      origin: null,
      destination: null,
      events: [],
      providerRef: null,
    });
    setup([scripted]);
    const changes: StatusChange[] = [];
    service.on('statusChanged', (c) => changes.push(c));

    const id = (await add('GGGGG1')).json().package.id as string;
    await service.refresh(id); // same status: no event
    status = 'unknown';
    await service.refresh(id); // provider lost its data: keep in_transit
    expect(service.get(id).status).toBe('in_transit');
    status = 'delivered';
    await service.refresh(id);

    expect(changes.map((c) => [c.previous, c.package.status])).toEqual([
      ['unknown', 'in_transit'],
      ['in_transit', 'delivered'],
    ]);
  });
});

describe('webhooks', () => {
  beforeEach(() => setup([new Track17Provider('WHKEY'), new MockProvider()]));
  afterEach(async () => {
    await app.close();
    store.close();
  });

  const payload = (number: string) =>
    JSON.stringify({
      event: 'TRACKING_UPDATED',
      data: {
        number,
        carrier: 100002,
        track_info: {
          latest_status: { status: 'Delivered', sub_status_descr: 'Delivered to door' },
          tracking: {
            providers: [{ provider: { name: 'UPS' }, events: [{ time_iso: '2026-11-13T10:00:00Z', description: 'Delivered', stage: 'Delivered' }] }],
          },
        },
      },
    });

  it('rejects bad signatures and applies valid ones', async () => {
    const row = store.insert({ trackingNumber: 'HHHHH12345', label: null, description: null, carrierCode: null, postalCode: null, provider: '17track' });
    const body = payload('HHHHH12345');

    const bad = await app.inject({ method: 'POST', url: '/webhooks/17track', headers: { 'content-type': 'application/json', sign: 'bad' }, payload: body });
    expect(bad.statusCode).toBe(401);

    const sign = createHash('sha256').update(`${body}/WHKEY`).digest('hex');
    const ok = await app.inject({ method: 'POST', url: '/webhooks/17track', headers: { 'content-type': 'application/json', sign }, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, applied: 1 });
    expect(service.get(row.id)).toMatchObject({ status: 'delivered', carrierName: 'UPS' });
    expect(service.get(row.id).deliveredAt).toBe('2026-11-13T10:00:00.000Z');
  });

  it('ignores unknown numbers and unknown providers', async () => {
    const body = payload('ZZZZZ99999');
    const sign = createHash('sha256').update(`${body}/WHKEY`).digest('hex');
    const ok = await app.inject({ method: 'POST', url: '/webhooks/17track', headers: { 'content-type': 'application/json', sign }, payload: body });
    expect(ok.json()).toEqual({ ok: true, applied: 0 });
    expect((await app.inject({ method: 'POST', url: '/webhooks/mock', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(404);
  });
});
