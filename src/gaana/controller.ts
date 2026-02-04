import { FastifyReply, FastifyRequest } from 'fastify';
import { cache } from '../app';
import { capitalizeFirstLetter } from '../helpers/common';
import { fetchPost } from '../helpers/http';
import {
  mapGaanaAlbum,
  mapGaanaEntity,
  mapGaanaPlaylist,
  mapGaanaTrack,
} from '../mappers/gaana.mapper';
import { sendError, sendSuccess } from '../utils/response';
import { gaanaHomeMapper, gaanaSearchMapper } from './helper';

const GAANA_BASE_URL = 'https://gaana.com/apiv2';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const gaanaFetch = async <T>(params: Record<string, any>, languages?: string) => {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };

  if (languages) {
    // Languages come as comma separated values like "hindi,english"
    // We need to capitalize them for Gaana's __ul cookie: "Hindi%2CEnglish"
    const formattedLangs = languages
      .split(',')
      .map((l) => capitalizeFirstLetter(l.trim()))
      .join(',');

    // Using encodeURIComponent to handle %2C for commas
    headers['Cookie'] = `__ul=${encodeURIComponent(formattedLangs)}`;
  }

  return fetchPost<T>(GAANA_BASE_URL, {
    params,
    body: '', // Sending empty body to ensure Content-Length: 0 is set for POST
    headers,
  });
};

export const homeController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  try {
    const key = `gaana_home_${lang || 'default'}`;
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK', 'gaana');

    const { data, error, message } = await gaanaFetch<any>({ type: 'home' }, lang);
    if (error) return sendError(res, message || 'Failed to fetch Gaana home', error);

    const sectionMetadata = gaanaHomeMapper(data);

    // Fetch top 10 sections in parallel
    const topSections = sectionMetadata.slice(0, 10);
    const sectionPromises = topSections.map(async (section: any) => {
      if (!section.url) return null;

      const { data: sectionData } = await gaanaFetch<any>(
        {
          apiPath: section.url,
          type: 'homeSec',
        },
        lang,
      );

      if (sectionData && sectionData.entities) {
        return {
          heading: section.heading,
          data: sectionData.entities.map(mapGaanaEntity),
          source: 'gaana',
        };
      }
      return null;
    });

    const populatedSections = (await Promise.all(sectionPromises)).filter((s) => s !== null);

    await cache.set(key, populatedSections, 3600);
    return sendSuccess(res, populatedSections, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const searchController = async (req: FastifyRequest, res: FastifyReply) => {
  const query = req.query as any;
  const q = query.q || query.query;
  const { lang } = req.query as any;
  if (!q) return sendError(res, 'Query parameter q is required', null, 400);

  try {
    const { data, error, message } = await gaanaFetch<any>({ type: 'search', keyword: q }, lang);
    if (error) return sendError(res, message || 'Search failed', error);

    const mappedData = gaanaSearchMapper(data);
    return sendSuccess(res, mappedData, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const playlistController = async (req: FastifyRequest, res: FastifyReply) => {
  const { playlistId } = req.params as any;
  const { lang } = req.query as any;
  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        seokey: playlistId,
        type: 'playlistDetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch playlist', error);

    const playlist = mapGaanaPlaylist(data.playlist || data);
    if (data.tracks) {
      playlist.songs = data.tracks.map((t: any) => mapGaanaTrack(t));
    }

    return sendSuccess(res, { playlist }, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const albumController = async (req: FastifyRequest, res: FastifyReply) => {
  const { albumId } = req.params as any;
  const { lang } = req.query as any;
  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        seokey: albumId,
        type: 'albumDetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch album', error);

    const album = mapGaanaAlbum(data.album || data);
    if (data.tracks) {
      album.songs = data.tracks.map((t: any) => mapGaanaTrack(t));
    }

    return sendSuccess(res, { album }, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const songController = async (req: FastifyRequest, res: FastifyReply) => {
  const { songId } = req.params as any;
  const { lang } = req.query as any;
  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        seokey: songId,
        type: 'songDetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch song', error);

    const song = mapGaanaTrack(data.tracks?.[0] || data.song || data);
    return sendSuccess(res, song, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};
