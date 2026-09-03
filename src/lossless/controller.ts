import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { cache } from '../redis';
import { matchSong } from '../matcher/match';
import { bestMatch } from '../matcher/score';
import { extractSongs, fromSong, type SongLike } from '../matcher/normalize';
import type { CanonicalTrack, EngineName } from '../matcher/types';
import { sendError, sendSuccess } from '../utils/response';
import { contentDisposition } from './lib/filename';
import { logger } from './lib/logger';
import * as progress from './lib/progress';
import { downloadGate } from './lib/semaphore';
import { createRegistry, engineStatus, getEngine } from './registry';
import { NotAvailableError, NotConfiguredError } from './engines/types';

const log = logger.child('routes.lossless');

/**
 * Lossless download endpoints.
 *
 * The download path streams: the FLAC is retagged in flight and piped straight
 * to the client, so a 40 MB hi-res track never lands in memory or on disk.
 */

function engineNames(): EngineName[] {
  return engineStatus().filter((e) => e.configured).map((e) => e.name);
}

/** GET /lossless/status */
export const statusController = async (_req: FastifyRequest, res: FastifyReply) => {
  return sendSuccess(
    res,
    {
      engines: engineStatus(),
      downloads: {
        active: downloadGate.active,
        waiting: downloadGate.waiting,
        limit: downloadGate.limit,
      },
      // Absent by design; see registry.ts for why.
      note: 'deezer is not compiled in: this runtime exposes no Blowfish cipher',
    },
    'Lossless engine status',
    'lossless',
  );
};

/** GET /lossless/search?q=&engine=&limit= */
export const searchController = async (req: FastifyRequest, res: FastifyReply) => {
  const { q, engine, limit } = req.query as { q?: string; engine?: EngineName; limit?: string };
  if (!q?.trim()) return sendError(res, 'Missing query parameter `q`.', null, 400);

  const names = engine ? [engine] : engineNames();
  if (names.length === 0) {
    return sendError(res, 'No lossless engine is configured.', null, 503);
  }

  const max = Math.min(Math.max(Number.parseInt(limit ?? '20', 10) || 20, 1), 50);
  const out: Record<string, unknown> = {};

  await Promise.all(
    names.map(async (name) => {
      const e = getEngine(name);
      if (!e?.isConfigured()) {
        out[name] = { error: 'not configured' };
        return;
      }
      try {
        out[name] = await e.search(q.trim(), max);
      } catch (err) {
        out[name] = { error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return sendSuccess(res, out, 'Lossless search', 'lossless');
};

interface DownloadBody {
  /** A Saavn or Gaana Song, or a search envelope containing one. */
  song?: unknown;
  /** Or an engine-native id / URL / free text. */
  input?: string;
  /** Restrict to one engine; otherwise the priority cascade is used. */
  engine?: EngineName;
  quality?: string;
  jobId?: string;
}

/**
 * Resolve which engine and identifier to download.
 *
 * When a Song is posted, the matcher decides: it finds the same recording on a
 * lossless engine and refuses rather than guessing, so a remix is never
 * substituted for the track that was asked for.
 */
async function resolveTarget(
  body: DownloadBody,
): Promise<{ engine: EngineName; input: string; hint?: Partial<CanonicalTrack>; via: string }> {
  const preferred = body.engine ? [body.engine] : engineNames();
  if (preferred.length === 0) throw new NotConfiguredError('qobuz', 'No lossless engine is configured.');

  if (body.input?.trim()) {
    return { engine: preferred[0]!, input: body.input.trim(), via: 'direct input' };
  }

  const song = extractSongs(body.song)[0];
  if (!song) throw new Error('Provide either `song` or `input`.');

  const target = fromSong(song);
  const engines = createRegistry();

  for (const name of preferred) {
    const engine = engines.get(name);
    if (!engine?.isConfigured()) continue;
    try {
      const results = await engine.search(
        [target.rawTitle ?? target.title, target.artists[0]].filter(Boolean).join(' '),
        15,
      );
      const match = bestMatch(target, results);
      if (match) {
        return {
          engine: name,
          input: (match.candidate as { sourceId: string }).sourceId,
          hint: target,
          via: `matched on ${name} (score ${match.score.toFixed(0)})`,
        };
      }
    } catch (err) {
      log.warn(`${name} search failed while resolving: ${String(err)}`);
    }
  }

  throw new NotAvailableError(
    preferred[0]!,
    `No lossless engine carries "${target.rawTitle ?? target.title}".`,
  );
}

/**
 * POST /lossless/download
 *
 * Body: { song } | { input } with optional { engine, quality, jobId }.
 * Responds with the audio stream itself, not JSON.
 */
export const downloadController = async (req: FastifyRequest, res: FastifyReply) => {
  const body = (req.body ?? {}) as DownloadBody;
  const jobId = body.jobId ?? (req.headers['x-download-job-id'] as string | undefined);

  let release: (() => void) | null = null;
  try {
    progress.update(jobId, 'Resolving', 3);
    const target = await resolveTarget(body);
    log.info(`download via ${target.via}`);

    const engine = getEngine(target.engine);
    if (!engine?.isConfigured()) {
      return sendError(res, `The ${target.engine} engine is not configured.`, null, 503);
    }

    release = await downloadGate.acquire();

    const result = await engine.download({
      input: target.input,
      quality: body.quality,
      hint: target.hint as never,
      onProgress: (stage, pct) => progress.update(jobId, stage, pct, { engine: target.engine }),
    });

    progress.update(jobId, 'Streaming to client', 97, { engine: target.engine });

    res.header('Content-Type', result.mimeType);
    res.header('Content-Disposition', contentDisposition(result.filename));
    res.header('Access-Control-Expose-Headers', 'Content-Disposition, X-Engine, X-Track-Id');
    res.header('X-Engine', target.engine);
    res.header('X-Track-Id', result.track.sourceId);
    res.header('Cache-Control', 'no-store');
    if (result.sizeBytes) res.header('Content-Length', String(result.sizeBytes));

    // The gate is held until the body has finished flowing, so the concurrency
    // limit reflects bandwidth actually in use rather than just the metadata
    // phase. Web stream -> Node stream is the bridge Fastify needs.
    const held = release;
    release = null;
    const node = Readable.fromWeb(result.stream as never);
    node.once('close', () => {
      progress.update(jobId, 'Ready', 100, { engine: target.engine });
      held();
    });

    return res.send(node);
  } catch (err) {
    release?.();
    const message = err instanceof Error ? err.message : String(err);
    progress.update(jobId, 'Download failed', 100, { error: message });

    if (err instanceof NotConfiguredError) return sendError(res, message, null, 503);
    if (err instanceof NotAvailableError) return sendError(res, message, null, 404);
    log.error(`download failed: ${message}`);
    return sendError(res, 'Download failed', message, 502);
  }
};

/** GET /lossless/progress/:jobId */
export const progressController = async (req: FastifyRequest, res: FastifyReply) => {
  const { jobId } = req.params as { jobId: string };
  const entry = progress.get(jobId);
  return entry
    ? sendSuccess(res, entry, 'Download progress', 'lossless')
    : sendError(res, 'Unknown job id', null, 404);
};

/**
 * POST /lossless/available
 *
 * Whether a Song can be had losslessly, without downloading it. Cached, so the
 * client can decorate a list cheaply.
 */
export const availableController = async (req: FastifyRequest, res: FastifyReply) => {
  const body = (req.body ?? {}) as { song?: unknown; songs?: unknown };
  const songs = extractSongs(body.songs ?? body.song);
  if (songs.length === 0) return sendError(res, 'Provide a `song` or `songs`.', null, 400);

  const results = await Promise.all(
    songs.slice(0, 50).map(async (song: SongLike) => {
      const key = `lossless_avail_v1_${String(song.source ?? 'saavn')}_${String(song.id ?? song.title ?? '')}`;
      const cached = await cache.get(key);
      if (cached) return cached;
      const match = await matchSong(song);
      const out = {
        id: song.id,
        title: song.title,
        available: Boolean(match.lossless),
        quality: match.lossless?.quality,
        hires: match.lossless?.hires ?? false,
        isrc: match.isrc,
        score: match.lossless?.score,
      };
      await cache.set(key, out, out.available ? 60 * 60 * 24 * 30 : 60 * 60 * 12);
      return out;
    }),
  );

  return sendSuccess(res, results.length === 1 ? results[0] : results, 'Lossless availability', 'lossless');
};
