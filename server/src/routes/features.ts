import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@minigis/shared';
import type { FeatureInput, FeatureStore } from '../storage/features.js';
import type { PhotoStore } from '../storage/photos.js';
import { userFromHeaders } from '../identity.js';

export function parseFid(raw: string): number | null {
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
}

function parseBbox(raw: string): [number, number, number, number] | null {
  const parts = raw.split(',');
  if (parts.length !== 4 || parts.some((p) => p.trim() === '')) return null;
  const n = parts.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const [minx, miny, maxx, maxy] = n;
  return minx <= maxx && miny <= maxy ? [minx, miny, maxx, maxy] : null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shape guard for request bodies; deeper geometry checks live in FeatureStore. */
function parseBody(body: unknown): FeatureInput | { errors: Record<string, string> } {
  if (!isObj(body)) return { errors: { geometry: 'Ungültige Geometrie' } };
  const out: FeatureInput = {};
  if (body.geometry !== undefined) {
    if (body.geometry !== null && !isObj(body.geometry)) {
      return { errors: { geometry: 'Ungültige Geometrie' } };
    }
    out.geometry = body.geometry as unknown as FeatureInput["geometry"];
  }
  if (body.properties !== undefined && body.properties !== null) {
    if (!isObj(body.properties)) return { errors: { properties: 'Ungültige Attribute' } };
    out.properties = body.properties;
  }
  return out;
}

export function featureRoutes(
  app: FastifyInstance,
  config: AppConfig,
  features: FeatureStore,
  photos: PhotoStore,
): void {
  const userOf = (headers: Record<string, string | string[] | undefined>) =>
    userFromHeaders(headers, config.app.userHeader);
  const hasLayer = (l: string) => Object.prototype.hasOwnProperty.call(config.layers, l);
  type P = { layer: string; fid: string };

  app.get<{ Params: { layer: string }; Querystring: { bbox?: string } }>(
    '/api/layers/:layer/features',
    async (req, reply) => {
      let bbox: [number, number, number, number] | undefined;
      if (req.query.bbox !== undefined) {
        const parsed = typeof req.query.bbox === 'string' ? parseBbox(req.query.bbox) : null;
        if (!parsed) return reply.code(422).send({ errors: { bbox: 'Ungültige BBox' } });
        bbox = parsed;
      }
      return features.list(req.params.layer, bbox);
    },
  );

  app.get<{ Params: P }>('/api/layers/:layer/features/:fid', async (req, reply) => {
    const fid = parseFid(req.params.fid);
    const f = fid === null ? null : await features.get(req.params.layer, fid);
    return f ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  app.post<{ Params: { layer: string } }>('/api/layers/:layer/features', async (req, reply) => {
    const input = parseBody(req.body);
    if ('errors' in input) {
      if (!hasLayer(req.params.layer)) return reply.code(404).send({ error: 'Ebene nicht gefunden' });
      return reply.code(422).send(input);
    }
    const f = await features.create(req.params.layer, input, userOf(req.headers));
    return reply.code(201).send(f);
  });

  app.put<{ Params: P }>('/api/layers/:layer/features/:fid', async (req, reply) => {
    const fid = parseFid(req.params.fid);
    if (fid === null) return reply.code(404).send({ error: 'Nicht gefunden' });
    const input = parseBody(req.body);
    if ('errors' in input) {
      if (!hasLayer(req.params.layer)) return reply.code(404).send({ error: 'Ebene nicht gefunden' });
      return reply.code(422).send(input);
    }
    const f = await features.update(req.params.layer, fid, input, userOf(req.headers));
    return f ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  app.delete<{ Params: P }>('/api/layers/:layer/features/:fid', async (req, reply) => {
    const fid = parseFid(req.params.fid);
    if (fid === null) return reply.code(404).send({ error: 'Nicht gefunden' });
    const ok = await features.delete(req.params.layer, fid, (l, f) => photos.deleteForFeature(l, f));
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'Nicht gefunden' });
  });
}
