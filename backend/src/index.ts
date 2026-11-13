import { loadConfig } from './config.js';
import { NoGeocoder, NominatimGeocoder } from './geocode.js';
import { buildProviders } from './providers/index.js';
import { buildServer } from './server.js';
import { TrackingService } from './service.js';
import { Store } from './store.js';

const config = loadConfig();
const store = new Store(config.databasePath);
const providers = buildProviders(config);
const geocoder =
  config.geocoder === 'off'
    ? new NoGeocoder()
    : new NominatimGeocoder(store, { baseUrl: config.geocoderUrl, userAgent: config.geocoderUserAgent });
const service = new TrackingService(store, providers, { refreshSpacingMs: config.refreshSpacingMs, geocoder });
const app = buildServer({ service, apiToken: config.apiToken, logger: true });

service.on('statusChanged', ({ package: pkg, previous }) => {
  // Hook for push notifications (APNs) — see README "Roadmap".
  app.log.info({ id: pkg.id, from: previous, to: pkg.status }, 'package status changed');
});

const cleaned = service.discardUnavailableDemoData();
if (cleaned > 0) app.log.info({ cleaned }, 'removed leftover demo data from packages');

if (providers.length === 0) {
  app.log.warn(
    'No tracking provider configured: packages are kept with a link to follow them by hand. ' +
      'Add DHL_API_KEY, SHIP24_API_KEY, ... to .env for automatic tracking (see .env.example).',
  );
} else if (providers.every((p) => p.name === 'mock')) {
  app.log.warn('No provider API key configured: using the offline mock provider (fake data).');
}

const poll = setInterval(() => {
  service.refreshAll().catch((err) => app.log.error(err, 'scheduled refresh failed'));
}, config.pollIntervalMinutes * 60_000);
poll.unref();

const shutdown = async () => {
  clearInterval(poll);
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
