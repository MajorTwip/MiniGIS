import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '@minigis/shared';
import type { FeatureStore } from '../storage/features.js';
import type { PhotoStore } from '../storage/photos.js';
import { userFromHeaders } from '../identity.js';
import { parseFid } from './features.js';

const CACHE = 'private, max-age=31536000, immutable';

export function photoRoutes(
  app: FastifyInstance,
  config: AppConfig,
  features: FeatureStore,
  photos: PhotoStore,
): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Nicht gefunden' });

  /** Validates layer (config + photos enabled) and feature existence; returns fid or null. */
  async function target(layer: string, rawFid: string): Promise<number | null> {
    if (!Object.prototype.hasOwnProperty.call(config.layers, layer)) return null;
    if (!config.layers[layer].photos) return null;
    const fid = parseFid(rawFid);
    if (fid === null) return null;
    return (await features.get(layer, fid)) ? fid : null;
  }

  type P = { layer: string; fid: string };

  app.get<{ Params: P }>('/api/layers/:layer/features/:fid/photos', async (req, reply) => {
    const fid = await target(req.params.layer, req.params.fid);
    if (fid === null) return notFound(reply);
    return photos.list(req.params.layer, fid);
  });

  app.post<{ Params: P }>('/api/layers/:layer/features/:fid/photos', async (req, reply) => {
    const fid = await target(req.params.layer, req.params.fid);
    if (fid === null) return notFound(reply);
    if (!req.isMultipart()) return reply.code(415).send({ errors: { file: 'Nur JPEG, PNG oder WebP' } });
    const user = userFromHeaders(req.headers, config.app.userHeader);
    const files: Array<{ filename: string; contentType: string; data: Buffer }> = [];
    for await (const part of req.files()) {
      files.push({ filename: part.filename, contentType: part.mimetype, data: await part.toBuffer() });
    }
    if (files.length === 0) return reply.code(422).send({ errors: { file: 'Keine Datei' } });
    const out = [];
    try {
      for (const f of files) out.push(await photos.add(req.params.layer, fid, f, user));
    } catch (e) {
      // all-or-nothing batch: undo photos already stored
      for (const m of out) await photos.delete(m.id);
      throw e;
    }
    return reply.code(201).send(out);
  });

  async function serve(id: string, reply: FastifyReply, thumb: boolean) {
    const p = await photos.get(id);
    if (!p) return notFound(reply);
    const file = thumb ? p.thumbPath : p.path;
    try {
      if (!(await stat(file)).isFile()) return notFound(reply);
    } catch {
      return notFound(reply);
    }
    return reply
      .header('Cache-Control', CACHE)
      .type(thumb ? 'image/jpeg' : p.meta.contentType)
      .send(createReadStream(file));
  }

  app.get<{ Params: { id: string } }>('/api/photos/:id', (req, reply) => serve(req.params.id, reply, false));
  app.get<{ Params: { id: string } }>('/api/photos/:id/thumb', (req, reply) =>
    serve(req.params.id, reply, true),
  );

  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) =>
    (await photos.delete(req.params.id)) ? reply.code(204).send() : notFound(reply),
  );
}
