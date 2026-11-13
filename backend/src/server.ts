import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { HttpError, ProviderError } from './domain.js';
import { safeEqual } from './providers/http.js';
import type { TrackingService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const addSchema = z.object({
  trackingNumber: z.string().trim().min(1).max(60),
  label: z.string().trim().max(120).nullish(),
  description: z.string().trim().max(500).nullish(),
  carrierCode: z.string().trim().max(60).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
});

const patchSchema = z
  .object({
    label: z.string().trim().max(120).nullable(),
    description: z.string().trim().max(500).nullable(),
    archived: z.boolean(),
  })
  .partial();

const listQuery = z.object({ archived: z.enum(['true', 'false']).default('false') });
const widgetQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) });

export interface ServerOptions {
  service: TrackingService;
  apiToken: string;
  logger?: boolean;
}

export function buildServer({ service, apiToken, logger = false }: ServerOptions): FastifyInstance {
  const app = Fastify({ logger });

  // Keep the raw body: webhook signatures are computed over the exact bytes received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'Invalid JSON body'), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'invalid_request', message: 'Invalid request', issues: err.issues },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: 'request_failed', message: err.message } });
    }
    if (err instanceof ProviderError) {
      return reply.code(502).send({ error: { code: 'provider_error', message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: { code: 'internal_error', message: status >= 500 ? 'Internal error' : (err as Error).message } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );

  // ---- public ---------------------------------------------------------------
  app.get('/health', async () => ({ ok: true }));

  app.post<{ Params: { provider: string } }>('/webhooks/:provider', async (req, reply) => {
    const provider = service.providerByName(req.params.provider);
    if (!provider?.webhook) return reply.code(404).send({ error: { code: 'not_found', message: 'Unknown provider' } });
    const raw = req.rawBody ?? '';
    if (!provider.webhook.verify(req.headers, raw)) {
      return reply.code(401).send({ error: { code: 'bad_signature', message: 'Invalid webhook signature' } });
    }
    let applied = 0;
    try {
      applied = service.handleWebhook(provider.name, provider.webhook.parse(raw));
    } catch (err) {
      req.log.warn({ err }, 'Unparseable webhook payload');
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'Unparseable webhook payload' } });
    }
    return { ok: true, applied };
  });

  // ---- authenticated API ----------------------------------------------------
  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || !safeEqual(token, apiToken)) {
        return reply.code(401).send({ error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } });
      }
    });

    api.get('/v1/packages', async (req) => {
      const { archived } = listQuery.parse(req.query);
      return { packages: service.list(archived === 'true') };
    });

    api.post('/v1/packages', async (req, reply) => {
      const body = addSchema.parse(req.body);
      return reply.code(201).send({ package: await service.add(body) });
    });

    api.get<{ Params: { id: string } }>('/v1/packages/:id', async (req) => ({
      package: service.get(req.params.id),
    }));

    api.patch<{ Params: { id: string } }>('/v1/packages/:id', async (req) => ({
      package: service.update(req.params.id, patchSchema.parse(req.body)),
    }));

    api.delete<{ Params: { id: string } }>('/v1/packages/:id', async (req, reply) => {
      await service.remove(req.params.id);
      return reply.code(204).send();
    });

    api.post<{ Params: { id: string } }>('/v1/packages/:id/refresh', async (req) => ({
      package: await service.refresh(req.params.id),
    }));

    api.post('/v1/refresh', async () => service.refreshAll());

    api.get('/v1/widget', async (req) => service.widget(widgetQuery.parse(req.query).limit));
  });

  return app;
}
