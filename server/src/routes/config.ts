import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@minigis/shared';

export function configRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/config', async () => config);
}
