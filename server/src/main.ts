import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

const configPath = process.env.MINIGIS_CONFIG ?? '/config/minigis.yaml';
const dataDir = process.env.MINIGIS_DATA ?? '/data';
const port = Number(process.env.PORT ?? 8080);
// server/dist/main.js -> ../../web/dist (repo layout); src/main.ts resolves the same way under tsx
const staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

try {
  const config = loadConfig(configPath);
  const app = await buildApp({ config, dataDir, staticDir });
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`MiniGIS listening on :${port}`);
  const stop = () => void app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
