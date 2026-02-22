import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { getToken, isValidArray, promiseAllLimit } from '../helpers/common';
import { fetchGet } from '../helpers/http';
import { isArray } from '../helpers/validators';
import { mapSaavnSong } from '../mappers/saavn.mapper';
import { cache } from '../redis';
import { ApiResponse, sendError, sendSuccess } from '../utils/response';
import {
  albumDataMapper,
  artistDataMapper,
  autoCompleteDataMapper,
  channelDataMapper,
  dataSanitizer,
  homeDataMapper,
  modulesDataMapper,
  playlistDataMapper,
  recommendationDataMapper,
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
    next: string;
  };
  Params: {
    albumId: string;
    year: string;
    playlistId: string;
    mixId: string;
    artistId: string;
    songId: string;
    channelId: string;
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
  const langList = languages.split(',').map((l: string) => l.trim().toLowerCase());
  const formattedLangs = langList.join(',');
  const primaryLang = langList[0] || 'hindi';

  const headers = {
    ...options.headers,
    cookie: `B=b7984e01db109802c47c5178fac7badc; CT=MjA2Mjg5ODMw; _pl=web6dot0-; DL=english; L=${encodeURIComponent(formattedLangs)}; geo=49.207.50.17%2CIN%2CKarnataka%2CBengaluru%2C562130; mm_latlong=12.9753%2C77.591; CH=G03%2CA07%2CO00%2CL03.; gdpr_acceptance=true`,
  };

  if (!options.params) options.params = {};
  if (!options.params.language) options.params.language = primaryLang;
  if (!options.params.languages) options.params.languages = formattedLangs;

  const response = await fetchGet<T>(url, { ...options, headers });
  return response;
};

export const getSaavnHomeData = async (languages?: string) => {
  const url = `${config.saavn.baseUrl}?__call=${config.saavn.endpoint.modules.home}`;
  const key = `saavn_home_v4_${languages || 'default'}`;

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

  const sanitizedData = recommendationDataMapper(data as any[]);
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

  const sanitizedData = recommendationDataMapper(data as any[]);
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
              data: recommendationDataMapper(result.value.data),
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
              data: recommendationDataMapper(result.value.data),
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
  const { language, name, query } = req.query as any;
  const languages = req.query.lang || req.query.languages || language || 'english';
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.radio.featured,
      language:
        languages && languages.toString().toLowerCase().includes('english') ? 'english' : languages,
      name: name || query,
      pid: '',
      query: query || '',
      mode: '',
      artistid: '',
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
const artistStationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { artistId, name, query } = req.query as any;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.radio.artist,
      artistid: artistId || '', // user reported it can be empty
      name: name || query || artistId, // prioritize name, then query, then id (which might be name)
      query: query || name || artistId,
      mode: '',
      ...params,
    },
    lang: languages,
  });

  if (error) return sendError(res, message || 'Failed to create artist station', error, code);
  return sendSuccess(res, data, message, 'saavn', code);
};

const entityStationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { entityId, entityType = 'song' } = req.query as any;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call:
        entityType === 'song'
          ? config.saavn.endpoint.radio.create
          : config.saavn.endpoint.radio.entity,
      entity_id: entityId,
      entity_type: entityType,
      pid: entityType === 'song' ? entityId : undefined,
      ...params,
      ctx: entityType === 'song' ? 'android' : params.ctx,
    },
    lang: languages,
  });

  if (error) return sendError(res, message || 'Failed to create entity station', error, code);
  return sendSuccess(res, data, message, 'saavn', code);
};
const featuredStationsController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.get.featured_stations,
      ...params,
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch featured stations', error, code);
  }

  const sanitizedData = isArray(data) ? data.map(dataSanitizer) : data;
  return sendSuccess(res, sanitizedData, message, 'saavn', code);
};

const stationSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  const { count, k, next = '1' } = req.query as any;
  const { stationId } = req.params as any;
  const languages = req.query.lang || req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.radio.songs,
      stationid: stationId,
      next: next,
      k: count || k || 20,
      ...params,
      ctx: 'android',
    },
    lang: languages,
  });

  if (error) {
    return sendError(res, message || 'Failed to fetch station songs', error, code);
  }

  if (data?.error) {
    console.error(`Saavn Radio Error for station ${stationId}:`, data.error);
    return sendError(res, `Saavn API returned an error: ${data.error}`, data.error);
  }

  const sanitizedData = stationSongsMapper(data);
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

  // Hydrate sections like 'Singles' and 'Latest Release' to include mediaUrls
  for (const section of extractedData.sections || []) {
    const heading = section.heading?.toLowerCase();
    if (
      (heading === 'singles' || heading === 'latest release' || heading === 'latest releases') &&
      Array.isArray(section.data)
    ) {
      const hydratedData = await promiseAllLimit(
        section.data.slice(0, 20),
        10,
        async (item: any) => {
          try {
            if (item.type === 'song' && (!item.mediaUrls || item.mediaUrls.length === 0)) {
              const { data: fullSongData } = await saavnFetch<any>(url, {
                params: {
                  __call: config.saavn.endpoint.song.link, // webapi.get
                  token: item.id,
                  type: 'song',
                  ...params,
                },
                lang: languages,
              });
              const songData =
                fullSongData?.songs?.[0] || (isArray(fullSongData) ? fullSongData[0] : null);
              if (songData) {
                return mapSaavnSong(songData);
              }
            } else if (item.type === 'album') {
              const { data: albumData } = await saavnFetch<any>(url, {
                params: {
                  __call: config.saavn.endpoint.album.token, // webapi.get
                  token: item.id,
                  type: 'album',
                  ...params,
                },
                lang: languages,
              });
              if (albumData?.list?.[0]) {
                const songToken = getToken(
                  albumData.list[0].perma_url || albumData.list[0].url || '',
                );
                const songId = songToken || albumData.list[0].id;
                const { data: fullSongData } = await saavnFetch<any>(url, {
                  params: {
                    __call: config.saavn.endpoint.song.link,
                    token: songId,
                    type: 'song',
                    ...params,
                  },
                  lang: languages,
                });
                const songData =
                  fullSongData?.songs?.[0] || (isArray(fullSongData) ? fullSongData[0] : null);
                if (songData) {
                  return mapSaavnSong(songData);
                }
                return mapSaavnSong(albumData.list[0]);
              }
            }
          } catch (err) {
            console.error(`Failed to hydrate ${item.type} in artist section:`, err);
          }
          return item; // Fallback to original item if hydration fails
        },
      );
      section.data = hydratedData;
    }
  }

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
            song_id: d.songId,
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

export const getSaavnSongRecommendData = async (songId: string, languages?: string) => {
  const url = `${config.saavn.baseUrl}`;

  // 1. Fetch song details context
  const { data, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.song.link,
      token: songId,
      type: 'song',
      ...params,
    },
    lang: languages,
  });

  if (error || !data?.songs?.[0]) {
    throw new Error(message || 'Failed to fetch song context');
  }

  const songIdNumeric = (data as any)?.songs[0]?.id;
  const songData = songsDetailsMapper(data);

  // 2. Prepare parallel fetchers
  const promiseArr: { title: string; promise: Promise<any> }[] = (songData.sections || [])
    .filter((d: any) => !['currentlyTrending', 'topSearches'].includes(d.module_id))
    .map((d: any) => {
      return {
        title: d.heading,
        promise: saavnFetch<any>(url, {
          params: {
            __call: d.endpoint,
            song_id: d.songId,
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

  // 3. Add explicit Similar Songs call (deterministic but high quality)
  promiseArr.push({
    title: 'Similar Songs',
    promise: saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.song.recommended,
        pid: songIdNumeric,
        ...params,
        ctx: 'android',
      },
      lang: languages,
    }),
  });

  // 4. Create and fetch from a Station for non-deterministic variety
  try {
    const { data: stationData } = await saavnFetch<any>(url, {
      params: {
        __call: config.saavn.endpoint.radio.create,
        pid: songIdNumeric,
        query: songData.songs[0]?.title || '',
        ...params,
        ctx: 'android',
      },
      lang: languages,
    });

    if (stationData?.stationid) {
      promiseArr.push({
        title: 'Station',
        stationid: stationData.stationid,
        promise: saavnFetch<any>(url, {
          params: {
            __call: config.saavn.endpoint.radio.songs,
            stationid: stationData.stationid,
            k: 25,
            next: 1,
            ...params,
            ctx: 'android',
          },
          lang: languages,
        }),
      } as any);
    }
  } catch (e) {
    // Radio station creation failed, continue without it
  }

  // 5. Execute all recommendation sources
  const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

  // 6. Flatten and De-duplicate
  const recommendationsMap = new Map<string, any>();
  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value?.data) {
      const rawData = result.value.data;
      let songs: any[] = [];

      // Handle various response formats from Saavn
      if (Array.isArray(rawData)) {
        songs = rawData;
      } else if (typeof rawData === 'object') {
        for (const k in rawData) {
          if (rawData[k]?.song) {
            songs.push(rawData[k].song);
          } else if (rawData[k]?.type === 'song') {
            songs.push(rawData[k]);
          } else if (Array.isArray(rawData[k])) {
            songs.push(...rawData[k]);
          }
        }
      }

      songs.forEach((s) => {
        if (s.type === 'song') {
          const sanitized = songDataSanitizer([s])[0];
          if (sanitized && sanitized.id !== songIdNumeric && sanitized.id !== songId) {
            recommendationsMap.set(sanitized.id, sanitized);
          }
        }
      });
    }
  });

  const recommendations = Array.from(recommendationsMap.values());
  const stationId = (promiseArr.find((p) => p.title === 'Station' && (p as any).stationid) as any)
    ?.stationid;

  return {
    list: recommendations,
    stationId,
  };
};

const recommendedSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { songId } = req.params;
    const languages = req.query.lang || req.query.languages;

    const data = await getSaavnSongRecommendData(songId, languages);
    return sendSuccess(res, data, 'OK', 'saavn');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch recommendations', error);
  }
};

const channelController = async (req: SaavnRequest, res: FastifyReply) => {
  const { channelId } = req.params as any;
  const { page = 1, count = 50 } = req.query as any;
  const languages = req.query.lang || req.query.languages;
  const key = `saavn_channel_${channelId}_${page}_${count}_${languages || 'default'}`;

  try {
    const cached = await cache.get(key);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'saavn');

    // Detect if channelId is a token (perma_url segment) or a numeric ID
    // Tokens usually contain non-numeric characters and are longer
    const isToken = isNaN(Number(channelId));
    console.log(`📦 Saavn: Fetching channel detail`, { channelId, isToken });

    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await saavnFetch<any>(url, {
      params: {
        __call: isToken ? config.saavn.endpoint.channel.token : config.saavn.endpoint.channel.id,
        [isToken ? 'token' : 'channel_id']: channelId,
        type: 'channel',
        p: page,
        n: count,
        includeMetaTags: 0,
        ...params,
      },
      lang: languages,
    });

    if (error) {
      return sendError(res, message || 'Failed to fetch channel details', error, code);
    }

    // Log the structure for debugging if data is empty
    if (
      !data ||
      (Array.isArray(data) && data.length === 0) ||
      (data.status === 'success' && !data.data)
    ) {
      console.warn(`⚠️ Saavn API returned empty data for channel: ${channelId}`, {
        keys: data ? Object.keys(data) : 'null',
      });
    }

    const sanitizedData = channelDataMapper(data);

    if (sanitizedData.length === 0) {
      console.warn(`⚠️ channelDataMapper returned no sections for channel: ${channelId}`);
    } else {
      console.log(`✅ Saavn: Mapped ${sanitizedData.length} sections for channel: ${channelId}`);
    }

    await cache.set(key, sanitizedData, 10800);
    return sendSuccess(res, sanitizedData, message, 'saavn', code);
  } catch (error) {
    console.error(`❌ Error in channelController:`, error);
    return sendError(res, 'Internal server error', error);
  }
};

export {
  albumController,
  albumRecommendationController,
  artistController,
  artistStationController,
  channelController,
  entityStationController,
  featuredStationsController,
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
export const getSaavnSearchData = async (
  q: string,
  type: string = 'all',
  page: number = 1,
  count: number = 20,
  languages?: string,
) => {
  const url = `${config.saavn.baseUrl}`;
  const { data, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.search[type] || config.saavn.endpoint.search.all,
      q,
      query: q,
      p: page,
      n: count,
      ...params,
      api_version: ['artist', 'all'].includes(type) ? 3 : 4,
    },
    lang: languages,
  });

  if (error) throw new Error(message || 'Saavn search failed');

  switch (type) {
    case 'albums':
      return {
        heading: 'Albums',
        list: (data as any).results.map((d: any) => albumDataMapper(d)),
        source: 'saavn',
        count: (data as any).total,
      };
    case 'songs':
      return {
        heading: 'Songs',
        list: songDataSanitizer((data as any).results),
        source: 'saavn',
        count: (data as any).total,
      };
    case 'artists':
      return {
        heading: 'Artists',
        list: (data as any).results.map((d: any) => artistDataMapper(d)),
        source: 'saavn',
        count: (data as any).total,
      };
    case 'playlists':
      return {
        heading: 'Playlists',
        list: (data as any).results.map((d: any) => playlistDataMapper(d)),
        source: 'saavn',
        count: (data as any).total,
      };
    default:
      return autoCompleteDataMapper(data);
  }
};

export const getSaavnTopSearchData = async (languages?: string) => {
  const url = `${config.saavn.baseUrl}`;
  const { data, error, message } = await saavnFetch<any>(url, {
    params: {
      __call: config.saavn.endpoint.search.top_search,
      ...params,
    },
    lang: languages,
  });

  if (error) throw new Error(message || 'Saavn top search failed');

  return topSearchMapper(data);
};
