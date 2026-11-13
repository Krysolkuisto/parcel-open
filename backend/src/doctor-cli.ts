import { loadConfig } from './config.js';
import { diagnose } from './doctor.js';

const config = loadConfig();
if (config.providers.length === 0) {
  console.log('No provider configured yet. Save a key with: npm run set-key -- DHL_API_KEY');
  console.log('(also LAPOSTE_API_KEY, UPS_CLIENT_ID + UPS_CLIENT_SECRET, SHIP24_API_KEY, TRACK17_API_KEY, AFTERSHIP_API_KEY)');
  process.exit(0);
}
let failed = false;
for (const check of await diagnose(config)) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.provider}: ${check.message}`);
  if (!check.ok) failed = true;
}
process.exit(failed ? 1 : 0);
