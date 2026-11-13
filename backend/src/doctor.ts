import type { Config } from './config.js';
import { ProviderError } from './domain.js';
import { buildProviders } from './providers/index.js';

export interface Check {
  provider: string;
  ok: boolean;
  message: string;
}

/** Tests every configured provider's credentials. Never prints or returns the credentials themselves. */
export async function diagnose(config: Config, fetchImpl: typeof fetch = fetch): Promise<Check[]> {
  const checks: Check[] = [];
  for (const provider of buildProviders(config, fetchImpl)) {
    if (!provider.verify) {
      checks.push({ provider: provider.name, ok: true, message: 'nothing to verify' });
      continue;
    }
    try {
      await provider.verify();
      checks.push({ provider: provider.name, ok: true, message: 'credentials accepted' });
    } catch (err) {
      const message = err instanceof ProviderError ? err.message : (err as Error).message;
      checks.push({ provider: provider.name, ok: false, message });
    }
  }
  return checks;
}
