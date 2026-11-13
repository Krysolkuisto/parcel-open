// Saves one provider key into backend/.env without showing it on screen or in shell history.
//   npm run set-key -- DHL_API_KEY
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWED = [
  'DHL_API_KEY',
  'LAPOSTE_API_KEY',
  'UPS_CLIENT_ID',
  'UPS_CLIENT_SECRET',
  'SHIP24_API_KEY',
  'TRACK17_API_KEY',
  'AFTERSHIP_API_KEY',
  'AFTERSHIP_WEBHOOK_SECRET',
];

const name = process.argv[2];
if (!ALLOWED.includes(name)) {
  console.error(`Usage: npm run set-key -- <NAME>\nNAME is one of: ${ALLOWED.join(', ')}`);
  process.exit(1);
}

const envFile = process.env.ENV_FILE ?? fileURLToPath(new URL('../.env', import.meta.url));

/** Reads a line; characters are not echoed when stdin is a terminal. */
function readSecret(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split('\n')[0] ?? ''));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl-C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const value = (await readSecret(`${name} (input is hidden): `)).trim();
if (!value || /[\r\n]/.test(value)) {
  console.error('Nothing saved: the value was empty.');
  process.exit(1);
}

const lines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split('\n') : [];
const index = lines.findIndex((line) => line.startsWith(`${name}=`));
if (index >= 0) lines[index] = `${name}=${value}`;
else {
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(`${name}=${value}`, '');
}
writeFileSync(envFile, lines.join('\n'));
chmodSync(envFile, 0o600);
console.log(`Saved ${name} to ${envFile}. Restart the backend, then run: npm run doctor`);
