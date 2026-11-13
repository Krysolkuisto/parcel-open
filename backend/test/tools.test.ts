import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { diagnose } from '../src/doctor.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('doctor', () => {
  it('reports which credentials work, without ever echoing them', async () => {
    const config = loadConfig({ API_TOKEN: 't', DHL_API_KEY: 'SECRET-DHL', UPS_CLIENT_ID: 'cid', UPS_CLIENT_SECRET: 'SECRET-UPS' });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api-eu.dhl.com')) return json({ status: 404 }, 404); // unknown number: key is fine
      if (u.includes('/oauth/token')) return json({ error: 'invalid_client' }, 401); // wrong UPS secret
      return json({}, 500);
    });

    const checks = await diagnose(config, fetchMock as unknown as typeof fetch);

    expect(checks).toEqual([
      { provider: 'dhl', ok: true, message: 'credentials accepted' },
      { provider: 'ups', ok: false, message: 'UPS rejected the client id or secret' },
    ]);
    expect(JSON.stringify(checks)).not.toContain('SECRET');
  });

  it('flags a rejected DHL key and a rejected Ship24 key', async () => {
    const config = loadConfig({ API_TOKEN: 't', DHL_API_KEY: 'bad', SHIP24_API_KEY: 'bad' });
    const fetchMock = vi.fn(async () => json({}, 401));
    const checks = await diagnose(config, fetchMock as unknown as typeof fetch);
    expect(checks.map((c) => [c.provider, c.ok])).toEqual([['dhl', false], ['ship24', false]]);
  });
});

describe('set-key script', () => {
  const run = (name: string, input: string, env: string) =>
    spawnSync('node', ['scripts/set-key.mjs', name], { input, encoding: 'utf8', env: { ...process.env, ENV_FILE: env } });

  it('adds and replaces keys, keeps other lines, and restricts the file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'parcel-env-')), '.env');
    writeFileSync(file, 'API_TOKEN=keepme\nDHL_API_KEY=old\n');

    expect(run('DHL_API_KEY', 'new-value/with+chars=\n', file).status).toBe(0);
    expect(run('UPS_CLIENT_ID', 'abc\n', file).status).toBe(0);

    expect(readFileSync(file, 'utf8')).toBe('API_TOKEN=keepme\nDHL_API_KEY=new-value/with+chars=\nUPS_CLIENT_ID=abc\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('never prints the value, and refuses unknown names and empty input', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'parcel-env-')), '.env');
    const ok = run('DHL_API_KEY', 'TOPSECRET\n', file);
    expect(ok.stdout + ok.stderr).not.toContain('TOPSECRET');

    expect(run('SOMETHING_ELSE', 'x\n', file).status).toBe(1);
    expect(run('SHIP24_API_KEY', '\n', file).status).toBe(1);
    expect(readFileSync(file, 'utf8')).not.toContain('SHIP24');
  });
});
