import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { isValidArray } from '../helpers/common';
import { fetchGet } from '../helpers/http';
import { cache } from '../redis';
import { ApiResponse, sendError, sendSuccess } from '../utils/response';
import {
  albumDataMapper,
  artistDataMapper,
  autoCompleteDataMapper,
  homeDataMapper,
  modulesDataMapper,
  playlistDataMapper,
  recommendedAlbumDataMapper,
  songDataSanitizer,
  songsDetailsMapper,
  stationSongsMapper,
  topSearchMapper,
} from './helper';

type SaavnRequest = FastifyRequest<{
  Querystring: {
    languages: string;
    language: string;
    lang: string;
    page: number;
    count: number;
    name: string;
    stationId: string;
    q: string;
    type: string;
  };
  Params: {
    albumId: string;
    year: string;
    playlistId: string;
    mixId: string;
    artistId: string;
    songId: string;
  };
}>;

const params = {
  api_version: config.saavn.api_version,
  _format: config.saavn._format,
  _marker: config.saavn._marker,
  ctx: config.saavn.ctx,
};

const saavnFetch = async <T>(url: string, options: any = {}) => {
  const languages = options.lang || 'hindi,english';
  // Saavn L cookie uses comma separated lowercase languages, usually encoded
  const formattedLangs = languages
    .split(',')
    .map((l: string) => l.trim().toLowerCase())
    .join(',');

  const headers = {
    ...options.headers,
    cookie: `B=b7984e01db109802c47c5178fac7badc; CT=MjA2Mjg5ODMw; _pl=web6dot0-; DL=english; L=${encodeURIComponent(formattedLangs)}; geo=49.207.50.17%2CIN%2CKarnataka%2CBengaluru%2C562130; mm_latlong=12.9753%2C77.591; CH=G03%2CA07%2CO00%2CL03.; gdpr_acceptance=true`,
  };

  return fetchGet<T>(url, { ...options, headers });
};

export const getSaavnHomeData = async (languages?: string) => {
  const url = `${config.saavn.baseUrl}?__call=${config.saavn.endpoint.modules.home}`;
  const key = `home_${languages}`;

  const cacheData = await cache.get<ApiResponse<any>>(key);
  if (cacheData) {
    return cacheData.data;
  }

  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      ...params,
    },
    lang: languages,
  });

  if (error) {
    throw new Error(message || 'Failed to fetch Saavn home data');
  }

  const sanitizedData = homeDataMapper(data);
  const response = {
    status: 'success' as const,
    message: message || 'Home data fetched successfully',
    data: sanitizedData,
    error: null,
    source: 'saavn',
  };

  cache.set(key, { ...response, code });
  return sanitizedData;
};

const homeController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const languages = req.query.lang || req.query.languages;
    const data = await getSaavnHomeData(languages);
    return sendSuccess(res, data, 'Home data fetched successfully', 'saavn');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch home data', error);
  }
};

const modulesController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.lang || req.query.languages;
  const key = `saavn_modules_${languages || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');

    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await saavnFetch<any>(url, {
      params: {
        ...params,
        __call: config.saavn.endpoint.modules.browse_modules,
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch modules', error, code);
    }

    const sanitizedData = modulesDataMapper(data);
    await cache.set(key, sanitizedData, 10800);
    return sendSuccess(res, sanitizedData, message, 'saavn', code);
  } catch (error) {
    return sendError(res, 'Internal server error', error);
  }
};

const albumRecommendationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { albumId } = req.params;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.album.recommended,
      albumid: albumId,
      type: 'album',
      includeMetaTags: 0,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch album recommendations', error, code);
  }

  const sanitizedData = recommendedAlbumDataMapper(data as any[]);
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const topAlbumsOfYearController = async (req: SaavnRequest, res: FastifyReply) => {
  const { year } = req.params;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.album.top_albums_by_year,
      album_year: year,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch top albums', error, code);
  }

  const sanitizedData = recommendedAlbumDataMapper(data as any[]);
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const albumController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { albumId } = req.params;
    const languages = req.query.lang || req.query.languages;
    const cacheData = await cache.get(`${albumId}_${languages}`);
    if (cacheData) {
      return res.code(cacheData.code || 200).send(cacheData);
    }

    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.album.token,
        token: albumId,
        type: 'album',
        includeMetaTags: 0,
        ...params,
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch album details', error, code);
    }

    const sanitizedData: any = albumDataMapper(data);
    const promiseArr = (sanitizedData.sections || []).map((d: any) => {
      return {
        title: d.heading,
        promise: saavnFetch<any>(url, {
          params: {
            __call: d.endpoint,
            albumid: d.albumId,
            album_year: d.year,
            type: d.type,
            language: d.language,
            ...params,
          },
          lang: languages,
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value?.data)
          ? {
              heading: promiseArr[index].title,
              data: recommendedAlbumDataMapper(result.value.data),
              source: 'saavn',
            }
          : null,
      )
      .filter((d: any) => d != null);

    const { sections: _, ...albumData } = sanitizedData;
    const finalData = { ...albumData, sections };
    const response = {
      status: 'success',
      message: message || 'Album details fetched successfully',
      data: finalData,
      error: null,
      source: 'saavn',
    };

    cache.set(`${albumId}_${languages}`, { ...response, code }, 10800);
    return res.code(code).send(response);
  } catch (error) {
    return sendError(res, 'Failed to fetch album details', error);
  }
};

const playlistController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { playlistId } = req.params;
    const { page = 0, count = 50 } = req.query;
    const languages = req.query.lang || req.query.languages;
    const key = `saavn_playlist_${playlistId}_${page}_${count}_${languages || 'default'}`;

    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');

    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.playlist.token,
        token: playlistId,
        type: 'playlist',
        includeMetaTags: 0,
        n: count,
        p: page,
        ...params,
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch playlist', error, code);
    }

    const sanitizedData: any = playlistDataMapper(data);
    const promiseArr = (sanitizedData.sections || []).map((d: any) => {
      return {
        title: d.heading,
        promise: saavnFetch<any>(url, {
          params: {
            __call: d.endpoint,
            listid: d.listId,
            entity_type: d.type,
            entity_language: d.language,
            ...params,
          },
          lang: languages,
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value?.data)
          ? {
              heading: promiseArr[index].title,
              data: recommendedAlbumDataMapper(result.value.data),
              source: 'saavn',
            }
          : null,
      )
      .filter((d: any) => d != null);

    const { sections: _, ...playlistData } = sanitizedData;
    const finalData = { ...playlistData, sections };
    await cache.set(key, finalData, 10800);
    return sendSuccess(res, finalData, message, 'saavn', code);
  } catch (error) {
    return sendError(res, 'Failed to fetch playlist', error);
  }
};

const mixController = async (req: SaavnRequest, res: FastifyReply) => {
  const { mixId } = req.params;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.playlist.token,
      token: mixId,
      type: 'mix',
      p: 1,
      n: 100,
      includeMetaTags: 0,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch mix', error, code);
  }

  const sanitizedData = albumDataMapper(data);
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const stationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { language, name } = req.query;
  const languages = req.query.lang || req.query.languages || language;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.radio.featured,
      language: languages,
      name: name,
      includeMetaTags: 0,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to create station', error, code);
  }

  return sendSuccess(res, data, message, 'saavn', code);
};

const stationSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  const { stationId, count } = req.query;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.radio.songs,
      stationid: stationId,
      next: 1,
      k: count,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch station songs', error, code);
  }

  const sanitizedData = await stationSongsMapper(data);
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const topSearchController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.search.top_search,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch top search', error, code);
  }

  const sortedData = topSearchMapper(data);
  return sendSuccess(res, sortedData, message, 'saavn', code);
};

const searchController = async (req: SaavnRequest, res: FastifyReply) => {
  const q = req.query.q as string;
  const type = ((req.query.type as string) || 'all').toLowerCase();
  const page = Number(req.query.page) || 1;
  const count = Number(req.query.count) || 30;
  const languages = req.query.lang || req.query.languages;

  const url = `${config.saavn.baseUrl}`;

  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.search[type],
      q,
      query: q,
      p: page,
      n: count,
      ...params,
      api_version: ['artist', 'all'].includes(type) ? 3 : 4,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Search failed', error, code);
  }

  const key = `saavn_search_${q}_${type}_${page}_${count}_${languages || 'default'}`;
  try {
    if (page === 1) {
      // Only cache first page of results? Or all? Let's cache all for now if unique
      const cached = await cache.get(key);
      if (cached && (cached as any).source) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');
    }
  } catch (e) {
    console.error('Cache read error', e);
  }

  let sanitizedData;
  try {
    switch (type) {
      case 'albums':
        sanitizedData = {
          heading: 'Albums',
          list: (data as any).results.map((d: any) => albumDataMapper(d)),
          source: 'saavn',
          count: (data as any).total,
        };
        break;
      case 'songs':
        sanitizedData = {
          heading: 'Songs',
          list: songDataSanitizer((data as any).results),
          source: 'saavn',
          count: (data as any).total,
        };
        break;
      case 'artists':
        sanitizedData = {
          heading: 'Artists',
          list: (data as any).results.map((d: any) => artistDataMapper(d)),
          source: 'saavn',
          count: (data as any).total,
        };
        break;
      case 'playlists':
        sanitizedData = {
          heading: 'Playlists',
          list: (data as any).results.map((d: any) => playlistDataMapper(d)),
          source: 'saavn',
          count: (data as any).total,
        };
        break;
      default:
        sanitizedData = autoCompleteDataMapper(data);
        break;
    }
  } catch (err) {
    console.error('Error in data mapping:', err);
    return sendError(res, 'Data mapping error', err);
  }

  if (page === 1) {
    cache.set(key, sanitizedData, 10800).catch(console.error);
  }
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const artistController = async (req: SaavnRequest, res: FastifyReply) => {
  const { artistId } = req.params;
  const { page = 0, count = 50 } = req.query;
  const languages = req.query.lang || req.query.languages;
  const key = `saavn_artist_${artistId}_${page}_${count}_${languages || 'default'}`;

  const cached = await cache.get(key);
  if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');

  const url = `${config.saavn.baseUrl}`;

  const { data, code, message, error } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.artist.link,
      token: artistId,
      type: 'artist',
      p: page,
      n_song: count,
      n_album: count,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch artist details', error, code);
  }

  const extractedData = artistDataMapper(data);
  await cache.set(key, extractedData, 10800);
  return sendSuccess(res, extractedData, message, 'saavn', code);
};

const songController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { songId } = req.params;
    const languages = req.query.lang || req.query.languages;
    const key = `saavn_song_${songId}_${languages || 'default'}`;

    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');

    const url = `${config.saavn.baseUrl}`;

    const { data, code, message, error } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.song.link,
        token: songId,
        type: 'song',
        ...params,
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch song details', error, code);
    }

    const { data: lyricsData } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.get.lyrics,
        lyrics_id: (data as any)?.songs[0]?.id,
        ...params,
      },
      lang: languages,
    });

    const songData = songsDetailsMapper(data);
    const promiseArr = (songData.sections || []).map((d: any) => {
      return {
        title: d.heading,
        promise: saavnFetch<any>(url, {
          params: {
            __call: d.endpoint,
            song_id: d.songIds,
            artist_ids: d.artistIds,
            type: d.type,
            language: d.language,
            actor_ids: d.actorIds,
            pid: d.pid,
            ...params,
          },
          lang: languages,
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value?.data)
          ? {
              heading: promiseArr[index].title,
              data: result.value.data.map((d: any) => {
                if (d.type === 'song') return songDataSanitizer([d])[0];
                if (d.type === 'album') return albumDataMapper(d);
                if (d.type === 'playlist') return playlistDataMapper(d);
                return albumDataMapper(d);
              }),
              source: 'saavn',
            }
          : null,
      )
      .filter((d: any) => d != null);

    const finalData = {
      ...(songData.songs?.length === 1 ? songData.songs[0] : { songs: songData.songs }),
      sections: sections,
      lyrics: (lyricsData as any)?.lyrics || '',
    };
    await cache.set(key, finalData, 10800);
    return sendSuccess(res, finalData, message, 'saavn', code);
  } catch (error) {
    return sendError(res, 'Failed to fetch song details', error);
  }
};

const recommendedSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { songId } = req.params;
    const languages = req.query.lang || req.query.languages;
    const url = `${config.saavn.baseUrl}`;

    const { data, code, message, error } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.song.recommended,
        pid: songId,
        language: languages,
        ...params,
        ctx: 'wap6dot0',
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch recommendations', error, code);
    }

    const sanitizedData = songDataSanitizer(data as any);
    return sendSuccess(res, sanitizedData, message, 'saavn', code);
  } catch (error) {
    return sendError(res, 'Failed to fetch recommendations', error);
  }
};

export {
  albumController,
  albumRecommendationController,
  artistController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  recommendedSongsController,
  searchController,
  songController,
  stationController,
  stationSongsController,
  topAlbumsOfYearController,
  topSearchController,
};
