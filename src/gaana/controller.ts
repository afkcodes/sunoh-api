import { FastifyReply, FastifyRequest } from 'fastify';
import { capitalizeFirstLetter, isValidTitle, promiseAllLimit } from '../helpers/common';
import { fetchGet, fetchPost } from '../helpers/http';
import {
  mapGaanaAlbum,
  mapGaanaArtist,
  mapGaanaEntity,
  mapGaanaPlaylist,
  mapGaanaTrack,
} from '../mappers/gaana.mapper';
import { cache } from '../redis';
import { sendError, sendSuccess } from '../utils/response';
import { gaanaHomeMapper, gaanaSearchMapper, gaanaSectionMapper } from './helper';

const GAANA_BASE_URL = 'https://gaana.com/apiv2';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

export const getGaanaHeaders = (languages?: string) => {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };

  if (languages) {
    const formattedLangs = languages
      .split(',')
      .map((l) => capitalizeFirstLetter(l.trim()))
      .join(',');
    headers['Cookie'] = `__ul=${encodeURIComponent(formattedLangs)}`;
  }
  return headers;
};

const gaanaFetch = async <T>(
  params: Record<string, any>,
  languages?: string,
  options: any = {},
) => {
  const headers = getGaanaHeaders(languages);

  const fetchOptions: any = {
    params,
    headers: {
      ...headers,
      'Content-Length': '0',
    },
    ...options,
  };

  return fetchPost<T>(GAANA_BASE_URL, fetchOptions);
};

const hydrateGaanaSections = async (sectionMetadata: any[], lang?: string) => {
  // Fetch all relevant sections in parallel
  const relevantSections = sectionMetadata.filter((section: any) => {
    if (!section.heading) return false;
    const excludedHeadings = ['Plan Upgrade', 'One Month Trial'];
    if (excludedHeadings.includes(section.heading)) return false;
    if (section.url && section.url.includes('gaanaplusservice')) return false;
    return section.url || section.seokey || (section.entities && section.entities.length > 0);
  });

  const fetchOptions = { timeout: 5000, retries: 1 };

  const populatedSections = (
    await promiseAllLimit(relevantSections, 5, async (section: any) => {
      // If entities are already present, use them
      if (section.entities && section.entities.length > 0) {
        const filteredData = section.entities
          .map(mapGaanaEntity)
          .filter((item: any) => isValidTitle(item.title || item.name));
        return {
          heading: section.heading,
          data: filteredData,
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
            fetchOptions,
          );

          if (sectionData && sectionData.entities) {
            const filteredData = sectionData.entities
              .map(mapGaanaEntity)
              .filter((item: any) => isValidTitle(item.title || item.name));
            return {
              heading: section.heading,
              data: filteredData,
              source: 'gaana',
            };
          }
        } catch (e) {
          console.error(`Failed to fetch collection detail for ${section.heading}:`, e);
        }
      }

      if (!section.url) return null;

      try {
        let sectionData: any;

        const isPublicGaanaUrl =
          section.url.startsWith('https://apiv2.gaana.com') ||
          section.url.startsWith('https://api.gaana.com');

        if (section.url.startsWith('http') && isPublicGaanaUrl) {
          // Direct fetch for discovery/occasion URLs to avoid proxy JSON errors
          const { data } = await fetchGet<any>(section.url, {
            headers: getGaanaHeaders(lang),
            ...fetchOptions,
          });
          sectionData = data;
        } else {
          const { data } = await gaanaFetch<any>(
            {
              apiPath: section.url,
              type: 'homeSec',
            },
            lang,
            fetchOptions,
          );
          sectionData = data;
        }

        if (sectionData && sectionData.entities) {
          const filteredData = sectionData.entities
            .map(mapGaanaEntity)
            .filter((item: any) => isValidTitle(item.title || item.name));
          return {
            heading: section.heading,
            data: filteredData,
            source: 'gaana',
          };
        }
      } catch (e) {
        console.error(`Failed to fetch section ${section.heading}:`, e);
      }
      return null;
    })
  ).filter((s) => s !== null && s.data.length > 0);

  return populatedSections;
};

export const getGaanaHomeData = async (lang?: string) => {
  const key = `gaana_home_v3_${lang || 'default'}`;
  const cached = await cache.get(key);
  if (cached) return cached;

  const { data, error, message } = await gaanaFetch<any>({ type: 'home' }, lang);
  if (error) throw new Error(message || 'Failed to fetch Gaana home');

  const sectionMetadata = gaanaHomeMapper(data);
  const populatedSections = await hydrateGaanaSections(sectionMetadata, lang);

  await cache.set(key, populatedSections, 10800);
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
  const key = `gaana_collection_${seokey}_${page}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

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
    await cache.set(key, mappedData, 10800);
    return sendSuccess(res, mappedData, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const albumListController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang, page = 0, language } = req.query as any;
  const targetLanguage = language || lang || 'hindi';
  const key = `gaana_album_list_v3_${targetLanguage}_${page}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

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
    await cache.set(key, albums, 10800);
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

  const key = `gaana_search_v4_${q}_${lang || 'default'}`;
  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const { data, error, message } = await gaanaFetch<any>({ type: 'search', keyword: q }, lang);
    if (error) return sendError(res, message || 'Search failed', error);

    const mappedData = gaanaSearchMapper(data);
    await cache.set(key, mappedData, 10800);
    return sendSuccess(res, mappedData, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const playlistController = async (req: FastifyRequest, res: FastifyReply) => {
  const { playlistId } = req.params as any;
  const { lang } = req.query as any;
  const key = `gaana_playlist_v3_${playlistId}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

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

    const result = { playlist };
    await cache.set(key, result, 10800);
    return sendSuccess(res, result, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const albumController = async (req: FastifyRequest, res: FastifyReply) => {
  const { albumId } = req.params as any;
  const { lang } = req.query as any;
  const key = `gaana_album_v3_${albumId}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

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

    const result = { album, sections };
    await cache.set(key, result, 10800);
    return sendSuccess(res, result, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const artistController = async (req: FastifyRequest, res: FastifyReply) => {
  const { artistId } = req.params as any;
  const { lang } = req.query as any;
  const key = `gaana_artist_v3_${artistId}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

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

    const result = { artist: artistBase, sections };
    await cache.set(key, result, 10800);
    return sendSuccess(res, result, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const songController = async (req: FastifyRequest, res: FastifyReply) => {
  const { songId } = req.params as any;
  const { lang } = req.query as any;
  const key = `gaana_song_v3_${songId}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const { data, error, message } = await gaanaFetch<any>(
      {
        seokey: songId,
        type: 'songDetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch song', error);

    const detailData = data.tracks?.[0] || data.song || data;
    const song = mapGaanaTrack(detailData);

    const internalSongId = detailData.track_id || detailData.entity_id;
    const albumId = detailData.album_id;
    const primaryArtistId = detailData.artist?.[0]?.artist_id;

    // Fetch similar songs and more from artist/album context in parallel
    const [similarRes, artistSongsRes] = await Promise.all([
      internalSongId
        ? gaanaFetch<any>({ type: 'songSimilar', id: internalSongId }, lang)
        : Promise.resolve({ data: null }),
      primaryArtistId
        ? gaanaFetch<any>({ type: 'albumArtistSongs', id: primaryArtistId, factor: 10 }, lang)
        : Promise.resolve({ data: null }),
    ]);

    const sections = [];

    if (similarRes.data?.tracks?.length > 0) {
      sections.push({
        heading: 'Similar Songs',
        data: similarRes.data.tracks.map(mapGaanaTrack),
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

    const result = { ...song, sections };
    await cache.set(key, result, 10800);
    return sendSuccess(res, result, 'OK', 'gaana');
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
  const key = `gaana_radio_${radioId}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const { data, error, message } = await gaanaFetch<any>(
      {
        id: radioId,
        type: 'gaanaradiodetail',
      },
      lang,
    );
    if (error) return sendError(res, message || 'Failed to fetch radio detail', error);

    const songs = (data.tracks || []).map((t: any) => mapGaanaTrack(t));
    await cache.set(key, songs, 10800);
    return sendSuccess(res, songs, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};
export const occasionController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  const key = `gaana_occasions_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const url = 'https://apiv2.gaana.com/home/discover/category-listing/178?new_artwork=1&v=1';
    const { data, error, message } = await fetchGet<any>(url, {
      headers: getGaanaHeaders(lang),
    });

    if (error) return sendError(res, message || 'Failed to fetch occasions', error);

    const occasions = (data.entities || []).map(mapGaanaEntity);
    await cache.set(key, occasions, 10800);
    return sendSuccess(res, occasions, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const occasionDetailController = async (req: FastifyRequest, res: FastifyReply) => {
  const { slug } = req.params as any;
  const { lang } = req.query as any;
  const key = `gaana_occasion_v3_${slug}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const url = `https://apiv2.gaana.com/home/occasion/metadata/${slug}`;
    const { data, error, message } = await fetchGet<any>(url, {
      headers: getGaanaHeaders(lang),
    });

    if (error) return sendError(res, message || 'Failed to fetch occasion detail', error);

    const sectionMetadata = gaanaSectionMapper(data.occasion);
    const sections = await hydrateGaanaSections(sectionMetadata, lang);

    await cache.set(key, sections, 10800);
    return sendSuccess(res, sections, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

export const occasionItemsController = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as any;
  const { lang, limit = '0,40' } = req.query as any;
  const key = `gaana_occasion_items_v3_${id}_${limit}_${lang || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'gaana');

    const url = `https://apiv2.gaana.com/home/discover/category/${id}?limit=${limit}`;
    const { data, error, message } = await fetchGet<any>(url, {
      headers: getGaanaHeaders(lang),
    });

    if (error) return sendError(res, message || 'Failed to fetch occasion items', error);

    const mappedData = (data.entities || []).map(mapGaanaEntity);
    await cache.set(key, mappedData, 10800);
    return sendSuccess(res, mappedData, 'OK', 'gaana');
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};
export const getGaanaSearchData = async (q: string, lang?: string) => {
  const url = `https://gsearch.gaana.com/vichitih/go/v2`;
  const formattedLangs = lang
    ? lang
        .split(',')
        .map((l) => capitalizeFirstLetter(l.trim()))
        .join(',')
    : 'Hindi,English';

  const params = {
    geoLocation: 'IN',
    query: q,
    content_filter: '2',
    include: 'allItems',
    isRegSrch: '0',
    webVersion: 'mix',
    rType: 'web',
    usrLang: formattedLangs,
    isChrome: '1',
  };

  // User says POST, browser subagent says GET. I'll use GET as it worked for the browser.
  const { data, error, message } = await fetchGet<any>(url, {
    params,
    headers: {
      ...getGaanaHeaders(lang),
      deviceId: 'website',
      deviceType: 'GaanaWapApp',
      gaanaAppVersion: 'gaanaAndroid-8.48.2',
    },
  });

  if (error) throw new Error(message || 'Gaana search failed');

  return gaanaSearchMapper(data);
};

export const getGaanaTrendingSearchData = async (lang?: string) => {
  const { data, error, message } = await gaanaFetch<any>({ type: 'searchTrending' }, lang);

  if (error) throw new Error(message || 'Gaana trending search failed');

  // Trending returns { entities: [...] }
  return (data.entities || []).map(mapGaanaEntity);
};
