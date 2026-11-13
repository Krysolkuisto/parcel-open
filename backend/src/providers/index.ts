import type { Config } from '../config.js';
import type { TrackingProvider } from '../domain.js';
import { AfterShipProvider } from './aftership.js';
import { DhlProvider } from './dhl.js';
import type { FetchLike } from './http.js';
import { MockProvider } from './mock.js';
import { Track17Provider } from './track17.js';

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
        return new DhlProvider(config.dhlKey, fetchImpl);
      case 'mock':
        return new MockProvider();
      default:
        throw new Error(`Unknown provider "${name}" (expected 17track, aftership, dhl or mock)`);
    }
  });
}
