import type { Config } from '../config.js';
import type { TrackingProvider } from '../domain.js';
import { AfterShipProvider } from './aftership.js';
import { DhlProvider } from './dhl.js';
import type { FetchLike } from './http.js';
import { LaPosteProvider } from './laposte.js';
import { MockProvider } from './mock.js';
import { Ship24Provider } from './ship24.js';
import { withMinInterval } from './throttle.js';
import { Track17Provider } from './track17.js';
import { UpsProvider } from './ups.js';

export function buildProviders(config: Config, fetchImpl: FetchLike = fetch): TrackingProvider[] {
  return config.providers.map((name) => {
    switch (name) {
      case '17track':
        if (!config.track17Key) throw new Error('PROVIDERS includes 17track but TRACK17_API_KEY is not set');
        return new Track17Provider(config.track17Key, fetchImpl);
      case 'aftership':
        if (!config.aftershipKey) throw new Error('PROVIDERS includes aftership but AFTERSHIP_API_KEY is not set');
        return new AfterShipProvider(config.aftershipKey, config.aftershipWebhookSecret, fetchImpl);
      case 'dhl':
        if (!config.dhlKey) throw new Error('PROVIDERS includes dhl but DHL_API_KEY is not set');
        return withMinInterval(new DhlProvider(config.dhlKey, fetchImpl), 1100); // DHL allows 1 call per second
      case 'laposte':
        if (!config.laPosteKey) throw new Error('PROVIDERS includes laposte but LAPOSTE_API_KEY is not set');
        return new LaPosteProvider(config.laPosteKey, fetchImpl);
      case 'ups':
        if (!config.upsClientId || !config.upsClientSecret) {
          throw new Error('PROVIDERS includes ups but UPS_CLIENT_ID / UPS_CLIENT_SECRET are not set');
        }
        return new UpsProvider(config.upsClientId, config.upsClientSecret, fetchImpl);
      case 'ship24':
        if (!config.ship24Key) throw new Error('PROVIDERS includes ship24 but SHIP24_API_KEY is not set');
        return new Ship24Provider(config.ship24Key, fetchImpl);
      case 'mock':
        return new MockProvider();
      default:
        throw new Error(`Unknown provider "${name}" (expected dhl, ups, laposte, 17track, aftership, ship24 or mock)`);
    }
  });
}
