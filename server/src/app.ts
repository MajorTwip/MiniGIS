import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from '@minigis/shared';
import { Mutex, openGpkg, syncSchema } from './storage/db.js';
import { FeatureStore, UnknownLayerError, ValidationError } from './storage/features.js';
import { PhotoStore, UnsupportedTypeError } from './storage/photos.js';
import { configRoutes } from './routes/config.js';
import { featureRoutes } from './routes/features.js';
import { photoRoutes } from './routes/photos.js';

export async function buildApp(opts: {
  config: AppConfig;
  dataDir: string;
  staticDir?: string;
  /** Fastify logger; defaults to info-level logging (LOG_LEVEL). Tests pass false. */
  logger?: boolean;
}): Promise<FastifyInstance> {
  const { config, dataDir, staticDir } = opts;
  const logger = opts.logger ?? true;
  const ds = await openGpkg(join(dataDir, 'minigis.gpkg'));
  syncSchema(ds, config);
  const mutex = new Mutex();
  const features = new FeatureStore(ds, config, mutex);
  const photos = new PhotoStore(ds, dataDir, mutex);

  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false });
  app.addHook('onClose', async () => {
    ds.close();
  });


  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ValidationError) return reply.code(422).send({ errors: err.errors });
    if (err instanceof UnknownLayerError) return reply.code(404).send({ error: 'Ebene nicht gefunden' });
    if (err instanceof UnsupportedTypeError) {
      return reply.code(415).send({ errors: { file: 'Nur JPEG, PNG oder WebP' } });
    }
    if (err.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ errors: { file: 'Zu viele Dateien (max. 20)' } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send({ errors: { file: `Datei zu gross (max. ${config.app.maxPhotoMb} MB)` } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'Interner Fehler' });
  });

  configRoutes(app, config);
  featureRoutes(app, config, features, photos);
  // multipart is encapsulated here so SPA-fallback requests don't get its hooks
  await app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: config.app.maxPhotoMb * 1024 * 1024, files: 20 } });
    photoRoutes(scope, config, features, photos);
  });

  const hasStatic = staticDir !== undefined && existsSync(join(staticDir, 'index.html'));
  if (hasStatic) await app.register(fastifyStatic, { root: staticDir });
  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0];
    if (hasStatic && req.method === 'GET' && path !== '/api' && !path.startsWith('/api/')) {
      await reply.sendFile('index.html');
      return reply;
    }
    return reply.code(404).send({ error: 'Nicht gefunden' });
  });

  return app;
}
