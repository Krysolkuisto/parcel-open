import type { TrackInput, TrackingProvider, TrackingResult } from '../domain.js';

/**
 * Spaces out the calls of a provider that allows only a few requests per second (DHL: 1 per second),
 * so adding or refreshing dozens of packages at once does not trip its rate limit.
 */
export function withMinInterval(provider: TrackingProvider, minIntervalMs: number): TrackingProvider {
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const slot = (): Promise<void> => {
    const next = queue.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const wrapped: TrackingProvider = Object.create(provider) as TrackingProvider;
  wrapped.register = async (input: TrackInput): Promise<TrackingResult> => {
    await slot();
    return provider.register(input);
  };
  wrapped.refresh = async (input: TrackInput): Promise<TrackingResult> => {
    await slot();
    return provider.refresh(input);
  };
  return wrapped;
}
