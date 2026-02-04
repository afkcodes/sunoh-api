import { FastifyReply, FastifyRequest } from 'fastify';
import { cache } from '../app';
import { capitalizeFirstLetter } from '../helpers/common';
import { fetchPost } from '../helpers/http';
import {
  mapGaanaAlbum,
  mapGaanaArtist,
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

  const fetchOptions: any = {
    params,
    headers: {
      ...headers,
      'Content-Length': '0',
    },
  };

  return fetchPost<T>(GAANA_BASE_URL, fetchOptions);
};

export const getGaanaHomeData = async (lang?: string) => {
  const key = `gaana_home_${lang || 'default'}`;
  const cached = await cache.get(key);
  if (cached) return cached;

  const { data, error, message } = await gaanaFetch<any>({ type: 'home' }, lang);
  if (error) throw new Error(message || 'Failed to fetch Gaana home');

  const sectionMetadata = gaanaHomeMapper(data);

  // Fetch all relevant sections in parallel
  const relevantSections = sectionMetadata.filter((section: any) => {
    if (!section.heading) return false;
    const excludedHeadings = ['Plan Upgrade', 'One Month Trial'];
    if (excludedHeadings.includes(section.heading)) return false;
    if (section.url && section.url.includes('gaanaplusservice')) return false;
    return section.url || section.seokey || (section.entities && section.entities.length > 0);
  });

  const sectionPromises = relevantSections.map(async (section: any) => {
    // If entities are already present, use them
    if (section.entities && section.entities.length > 0) {
      return {
        heading: section.heading,
        data: section.entities.map(mapGaanaEntity),
        source: 'gaana',
      };
    }

    // Prioritize collectionsDetail if seokey is present
    if (section.seokey) {
      try {
        const { data: sectionData } = await gaanaFetch<any>(
          {
            type: 'collectionsDetail',
            seokey: section.seokey,
            page: 0,
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
      } catch (e) {
        console.error(`Failed to fetch collection detail for ${section.heading}:`, e);
      }
    }

    if (!section.url) return null;

    try {
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
    } catch (e) {
      console.error(`Failed to fetch section ${section.heading}:`, e);
    }
    return null;
  });

  const populatedSections = (await Promise.all(sectionPromises)).filter(
    (s) => s !== null && s.data.length > 0,
  );

  await cache.set(key, populatedSections, 3600);
  return populatedSections;
};

export const homeController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  try {
    const data = await getGaanaHomeData(lang);
    return sendSuccess(res, data, 'OK', 'gaana');
  } catch (error: any) {
    return sendError(res, error.message || 'Internal server error', error);
  }
};

export const collectionController = async (req: FastifyRequest, res: FastifyReply) => {
  const { seokey } = req.params as any;
  const { lang, page = 0 } = req.query as any;

  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        type: 'collectionsDetail',
        seokey,
        page,
      },
      lang,
    );

    if (error) return sendError(res, message || 'Failed to fetch collection', error);

    const mappedData = (data.entities || []).map(mapGaanaEntity);
    return sendSuccess(res, mappedData, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const albumListController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang, page = 0, language } = req.query as any;
  const targetLanguage = language || lang || 'hindi';

  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        type: 'albumList',
        language: targetLanguage,
        page,
      },
      lang,
    );

    if (error) return sendError(res, message || 'Failed to fetch albums', error);

    const albums = (data.album || []).map((album: any) =>
      mapGaanaEntity({ ...album, entity_type: 'ALBUM' }),
    );
    return sendSuccess(res, albums, 'OK', 'gaana');
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
    const {
      data: detailData,
      error,
      message,
    } = await gaanaFetch<any>(
      {
        seokey: albumId,
        type: 'albumDetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch album', error);

    const album = mapGaanaAlbum(detailData.album || detailData);
    if (detailData.tracks) {
      album.songs = detailData.tracks.map((t: any) => mapGaanaTrack(t));
    }

    const internalAlbumId = detailData.album?.album_id;
    const primaryArtistId = detailData.album?.primaryartist?.[0]?.artist_id;

    // Fetch similar albums and more from artist in parallel
    const [similarRes, artistSongsRes] = await Promise.all([
      internalAlbumId
        ? gaanaFetch<any>({ type: 'albumSimilar', id: internalAlbumId }, lang)
        : Promise.resolve({ data: null }),
      primaryArtistId
        ? gaanaFetch<any>({ type: 'albumArtistSongs', id: primaryArtistId, factor: 10 }, lang)
        : Promise.resolve({ data: null }),
    ]);

    const sections = [];

    if (similarRes.data?.album?.length > 0) {
      sections.push({
        heading: 'Similar Albums',
        data: similarRes.data.album.map((a: any) => {
          // Explicitly set entity_type for mapping
          a.entity_type = 'ALBUM';
          return mapGaanaEntity(a);
        }),
        source: 'gaana',
      });
    }

    if (artistSongsRes.data?.entities?.length > 0) {
      sections.push({
        heading: 'More from Artist',
        data: artistSongsRes.data.entities.map(mapGaanaEntity),
        source: 'gaana',
      });
    }

    return sendSuccess(res, { album, sections }, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const artistController = async (req: FastifyRequest, res: FastifyReply) => {
  const { artistId } = req.params as any;
  const { lang } = req.query as any;

  try {
    const { data: artistDetail, error: detailError } = await gaanaFetch<any>(
      {
        type: 'artistDetailNew',
        seokey: artistId,
      },
      lang,
    );

    if (detailError || !artistDetail.artist) {
      return sendError(res, 'Artist not found', detailError);
    }

    const artistBase = mapGaanaArtist(artistDetail.artist);
    const internalId = artistDetail.artist.artist_id;

    // Fetch tracks, albums, playlists, and similar artists in parallel
    const [tracksRes, albumsRes, playlistsRes, similarRes] = await Promise.all([
      gaanaFetch<any>(
        {
          type: 'artistDetailSection',
          apiPath: `https://apiv2.gaana.com/home/artist/tracks/${internalId}`,
          sortBy: 'popularity',
          sortOrder: 0,
          request_type: 'web',
          pkc: 'true',
          st: 'hls',
          song_type: 'new',
          limit: '0,20',
          index: 0,
        },
        lang,
      ),
      gaanaFetch<any>(
        {
          type: 'artistDetailSection',
          apiPath: `https://apiv2.gaana.com/home/artist/album/${internalId}`,
          index: 2,
        },
        lang,
      ),
      gaanaFetch<any>(
        {
          type: 'artistDetailSection',
          apiPath: `https://apiv2.gaana.com/home/artist/playlist/${internalId}`,
          index: 1,
        },
        lang,
      ),
      gaanaFetch<any>(
        {
          type: 'artistDetailSection',
          apiPath: `https://apiv2.gaana.com/player/similar-artists/${internalId}`,
          index: 4,
        },
        lang,
      ),
    ]);

    const sections = [];

    if (tracksRes.data?.entities?.length > 0) {
      sections.push({
        heading: 'Top Tracks',
        data: tracksRes.data.entities.map(mapGaanaEntity),
        source: 'gaana',
      });
    }

    if (albumsRes.data?.entities?.length > 0) {
      sections.push({
        heading: 'Top Albums',
        data: albumsRes.data.entities.map(mapGaanaEntity),
        source: 'gaana',
      });
    }

    if (playlistsRes.data?.entities?.length > 0) {
      sections.push({
        heading: 'Related Playlists',
        data: playlistsRes.data.entities.map(mapGaanaEntity),
        source: 'gaana',
      });
    }

    if (similarRes.data?.entities?.length > 0) {
      sections.push({
        heading: 'Similar Artists',
        data: similarRes.data.entities.map(mapGaanaEntity),
        source: 'gaana',
      });
    }

    return sendSuccess(res, { artist: artistBase, sections }, 'OK', 'gaana');
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

export const songStreamController = async (req: FastifyRequest, res: FastifyReply) => {
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
    if (error) return sendError(res, message || 'Failed to fetch song streams', error);

    const song = mapGaanaTrack(data.tracks?.[0] || data.song || data);
    return sendSuccess(res, song.mediaUrls, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const radioDetailController = async (req: FastifyRequest, res: FastifyReply) => {
  const { radioId } = req.params as any;
  const { lang } = req.query as any;
  try {
    const { data, error, message } = await gaanaFetch<any>(
      {
        id: radioId,
        type: 'gaanaradiodetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch radio detail', error);

    const songs = (data.tracks || []).map((t: any) => mapGaanaTrack(t));
    return sendSuccess(res, songs, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};
