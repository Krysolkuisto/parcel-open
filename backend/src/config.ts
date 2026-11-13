export interface Config {
  port: number;
  host: string;
  databasePath: string;
  apiToken: string;
  track17Key: string | null;
  aftershipKey: string | null;
  aftershipWebhookSecret: string | null;
  /** Provider names in priority order. */
  providers: string[];
  pollIntervalMinutes: number;
  /** Delay between two provider calls during a bulk refresh (17TRACK allows 3 req/s). */
  refreshSpacingMs: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const track17Key = env.TRACK17_API_KEY?.trim() || null;
  const aftershipKey = env.AFTERSHIP_API_KEY?.trim() || null;

  let providers = (env.PROVIDERS ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (providers.length === 0) {
    if (track17Key) providers.push('17track');
    if (aftershipKey) providers.push('aftership');
    if (providers.length === 0) providers = ['mock'];
  }

  const apiToken = env.API_TOKEN?.trim();
  if (!apiToken) {
    throw new Error('API_TOKEN is required. Generate one with: openssl rand -hex 32');
  }

  return {
    port: num(env.PORT, 8787),
    host: env.HOST?.trim() || '127.0.0.1',
    databasePath: env.DATABASE_PATH?.trim() || './data/parcel.db',
    apiToken,
    track17Key,
    aftershipKey,
    aftershipWebhookSecret: env.AFTERSHIP_WEBHOOK_SECRET?.trim() || null,
    providers,
    pollIntervalMinutes: num(env.POLL_INTERVAL_MINUTES, 30),
    refreshSpacingMs: num(env.REFRESH_SPACING_MS, 400),
  };
}
