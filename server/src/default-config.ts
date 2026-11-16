import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigError } from './config.js';

/**
 * Makes sure a config exists at `configPath`. If it is missing, the bundled
 * default is copied there so it can be edited. If that copy fails (e.g. the
 * folder is mounted read-only), the bundled default is used directly.
 * Returns the path to load.
 */
export function ensureConfig(
  configPath: string,
  defaultPath: string,
  log: (message: string) => void = console.log,
): string {
  if (existsSync(configPath)) return configPath;
  if (!existsSync(defaultPath)) {
    throw new ConfigError(`${configPath}: config not found, and no default config at ${defaultPath}`);
  }
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    copyFileSync(defaultPath, configPath);
    log(`No config at ${configPath}: copied the default config there. Edit it and restart.`);
    return configPath;
  } catch (e) {
    log(
      `No config at ${configPath} and could not copy the default there (${(e as Error).message}). ` +
        `Using the built-in default. Make the config folder writable (no ":ro") to get an editable copy.`,
    );
    return defaultPath;
  }
}
