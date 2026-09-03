import { logger } from './lib/logger';
import { ENGINE_ORDER, type EngineName } from '../matcher/types';
import { AmazonEngine } from './engines/amazon/index';
import { QobuzEngine } from './engines/qobuz/index';
import { TidalEngine } from './engines/tidal/index';
import type { LosslessEngine } from './engines/types';

const log = logger.child('engines');

const registry = new Map<EngineName, LosslessEngine>();
let initialised = false;

/** Engines compiled into this build, in download-priority order. */
export function createRegistry(): ReadonlyMap<EngineName, LosslessEngine> {
  if (registry.size > 0) return registry;
  registry.set('qobuz', new QobuzEngine());
  registry.set('tidal', new TidalEngine());
  registry.set('amazon', new AmazonEngine());
  // Deezer is absent on purpose: its streams are Blowfish-CBC and this runtime
  // exposes no Blowfish (OpenSSL 3 moved it to the legacy provider, so
  // `getCiphers()` lists none). Adding it needs a userland Blowfish first.
  return registry;
}

export function getEngine(name: EngineName): LosslessEngine | undefined {
  return createRegistry().get(name);
}

/** Engines that hold credentials and can actually be used right now. */
export function availableEngines(): LosslessEngine[] {
  const all = createRegistry();
  return ENGINE_ORDER.map((n) => all.get(n)).filter(
    (e): e is LosslessEngine => Boolean(e?.isConfigured()),
  );
}

export function engineStatus(): Array<{
  name: EngineName;
  present: boolean;
  configured: boolean;
}> {
  const all = createRegistry();
  return ENGINE_ORDER.map((name) => {
    const engine = all.get(name);
    return {
      name,
      present: Boolean(engine),
      configured: Boolean(engine?.isConfigured()),
    };
  });
}

/** Load persisted tokens. Safe to call repeatedly; only the first call works. */
export async function initEngines(): Promise<void> {
  if (initialised) return;
  initialised = true;
  const all = createRegistry();
  await Promise.all(
    [...all.values()].map(async (engine) => {
      const auth = (engine as { auth?: { load?: () => Promise<void> } }).auth;
      try {
        await auth?.load?.();
      } catch (err) {
        log.warn(`${engine.name} token load failed: ${String(err)}`);
      }
    }),
  );
  const ready = engineStatus()
    .filter((e) => e.configured)
    .map((e) => e.name);
  log.info(`lossless engines ready: ${ready.join(', ') || 'none (no credentials configured)'}`);
}

export { ENGINE_ORDER };
