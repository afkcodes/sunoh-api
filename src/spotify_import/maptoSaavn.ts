import https from 'https';
import { URLSearchParams } from 'url';

interface SpotifyTrack {
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  duration: string;
  id: string;
  url: string;
}

interface SaavnCandidate {
  id?: string;
  title?: string;
  name?: string;
  subtitle?: string;
  album?: string;
  albumId?: string;
  primaryArtists?: string;
  music?: string;
  singers?: string;
  duration?: string;
  images?: Array<{
    quality: string;
    link: string;
  }>;
  image?: {
    quality: string;
    link: string;
  };
  mediaUrls?: Array<{
    quality: string;
    link: string;
  }>;
  language?: string;
  year?: string;
  type?: string;
  isExplicit?: string;
  playCount?: string;
  label?: string;
  [key: string]: any;
}

interface MappedResult {
  spotify: SpotifyTrack;
  saavnBest: SaavnCandidate | null;
  score: number;
  query: string;
  candidatesConsidered: number;
}

interface MapOptions {
  debug?: boolean;
  limit?: number;
}

function httpGetJson(url: string): Promise<{ status: number; json: any; raw: string }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(body), raw: body });
          } catch (e) {
            reject(
              new Error(
                'JSON parse error: ' + (e as Error).message + ' body=' + body.slice(0, 200),
              ),
            );
          }
        });
      })
      .on('error', reject);
  });
}

// Simple normalization for comparison
function norm(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute a fuzzy similarity score between two strings (0..1)
function similarity(a: string, b: string): number {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Token set Jaccard weighted by token length
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  const inter = [...ta].filter((t) => tb.has(t));
  const union = new Set([...ta, ...tb]);
  const jaccard = inter.length / union.size;
  // Character overlap
  const overlap = inter.join('').length / Math.max(a.replace(/ /g, '').length, 1);
  return jaccard * 0.7 + overlap * 0.3;
}

function artistMatchScore(spotifyArtists: string[], saavnArtistsStr: string): number {
  const saavnArtists = saavnArtistsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let hits = 0;
  for (const s of spotifyArtists) {
    const ns = norm(s);
    if (saavnArtists.some((a) => norm(a) === ns)) hits++;
  }
  return hits / Math.max(spotifyArtists.length, 1);
}

function scoreCandidate(spotifyTrack: SpotifyTrack, candidate: SaavnCandidate): number {
  const titleScore = similarity(spotifyTrack.name, candidate.title || candidate.name || '');
  const artistScore = artistMatchScore(
    spotifyTrack.artists,
    candidate.primaryArtists || candidate.music || candidate.singers || '',
  );
  // Duration difference penalty (if durations available)
  const durSpotify = spotifyTrack.durationMs || 0;
  const durCandidate = (candidate.duration && parseInt(candidate.duration, 10) * 1000) || 0;
  let durationScore = 0.5; // neutral baseline
  if (durSpotify && durCandidate) {
    const diff = Math.abs(durSpotify - durCandidate);
    const ratio = diff / Math.max(durSpotify, 1);
    durationScore = Math.max(0, 1 - ratio); // linear decay
  }
  return titleScore * 0.55 + artistScore * 0.3 + durationScore * 0.15;
}

async function searchSaavn(
  query: string,
  debug: boolean = false,
): Promise<{ status: number; results: SaavnCandidate[]; error?: string }> {
  const params = new URLSearchParams({ q: query, type: 'songs' });
  const url = `https://api.sunoh.online/saavn/search?${params.toString()}`;
  if (debug) console.error('[debug] Saavn search:', url);
  try {
    const { status, json } = await httpGetJson(url);
    if (status !== 200) return { status, results: [] };
    // Extract songs from the response structure
    const songs =
      (json.data && json.data.list) ||
      (json.data && json.data.results) ||
      json.songs ||
      json.results ||
      [];
    return { status, results: songs };
  } catch (e) {
    if (debug) console.error('[debug] Saavn search error:', (e as Error).message);
    return { status: 0, results: [], error: (e as Error).message };
  }
}

async function mapTracks(tracks, opts) {
  const mapped = [];
  let processed = 0;
  for (const t of tracks) {
    processed++;
    if (processed > opts.limit) break;
    const cleanedTitle = t.name
      .replace(/-\s*from\s+"[^"]+"/i, '')
      .replace(/\(.*?version\)/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/"|”|“/g, '')
      .replace(/-\s*remix.*/i, '')
      .replace(/feat\..*/i, '')
      .replace(/\s+/g, ' ') // collapse
      .trim();
    const artistPart = t.artists.slice(0, 2).join(' ');
    const queryVariants = [
      `${cleanedTitle} ${artistPart}`.trim(),
      cleanedTitle,
      `${cleanedTitle.split(' ').slice(0, 3).join(' ')} ${t.artists[0] || ''}`.trim(),
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);
    let results = [];
    let usedQuery = queryVariants[0];
    for (const q of queryVariants) {
      const resp = await searchSaavn(q, opts.debug);
      if (resp.results.length) {
        results = resp.results;
        usedQuery = q;
        break;
      }
      if (!results.length) {
        results = resp.results;
        usedQuery = q;
      } // keep last attempt even if empty
    }
    let best = null;
    let bestScore = -1;
    for (const cand of results) {
      const score = scoreCandidate(t, cand);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    mapped.push({
      spotify: t,
      saavnBest: best,
      score: bestScore,
      query: usedQuery,
      candidatesConsidered: results.length,
    });
    if (opts.debug) console.error(`[debug] Mapped: ${t.name} -> score ${bestScore.toFixed(3)}`);
    // polite small delay to avoid hammering
    await new Promise((r) => setTimeout(r, 120));
  }
  return mapped;
}

// Export for API use
export { MapOptions, MappedResult, mapTracks, SaavnCandidate, SpotifyTrack };
