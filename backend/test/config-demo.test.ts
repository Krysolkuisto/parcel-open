import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { MockProvider } from '../src/providers/mock.js';
import { TrackingService } from '../src/service.js';
import { Store } from '../src/store.js';

describe('provider selection from the environment', () => {
  it('has no provider (and so no fake data) when no key is set', () => {
    expect(loadConfig({ API_TOKEN: 't' }).providers).toEqual([]);
  });

  it('orders free carrier APIs before aggregators, mock only when asked', () => {
    const env = { API_TOKEN: 't', TRACK17_API_KEY: 'a', DHL_API_KEY: 'b', SHIP24_API_KEY: 'c', AFTERSHIP_API_KEY: 'd' };
    expect(loadConfig(env).providers).toEqual(['dhl', '17track', 'aftership', 'ship24']);
    expect(loadConfig({ API_TOKEN: 't', PROVIDERS: 'mock' }).providers).toEqual(['mock']);
  });
});

describe('packages without any provider', () => {
  let store: Store;
  afterEach(() => store?.close());

  it('are kept as manual packages with a link, never given invented data', async () => {
    store = new Store(':memory:');
    const service = new TrackingService(store, []);
    const pkg = await service.add({ trackingNumber: 'RB123456789TH', label: 'thai' });
    expect(pkg).toMatchObject({ provider: 'manual', status: 'unknown', carrierName: 'Thailand Post' });
    expect(pkg.trackingUrl).toContain('thailandpost');
    expect(service.get(pkg.id).events).toEqual([]);
    expect(await service.refreshAll()).toEqual({ refreshed: 0, failed: 0, skipped: false });
  });

  it('drops leftover demo data when the mock provider is no longer configured', async () => {
    store = new Store(':memory:');
    const withMock = new TrackingService(store, [new MockProvider()]);
    const demo = await withMock.add({ trackingNumber: 'DEMO12345' });
    expect(demo.provider).toBe('mock');
    expect(withMock.discardUnavailableDemoData()).toBe(0); // mock still configured: keep

    const withoutMock = new TrackingService(store, []);
    expect(withoutMock.discardUnavailableDemoData()).toBe(1);
    const cleaned = withoutMock.get(demo.id);
    expect(cleaned).toMatchObject({ provider: 'manual', status: 'unknown', statusText: null });
    expect(cleaned.events).toEqual([]);
  });
});
