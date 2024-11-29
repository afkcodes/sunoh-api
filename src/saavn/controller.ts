import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { isValidArray } from '../helpers/common';
import { fetchGet } from '../helpers/http';
import {
  albumDataMapper,
  artistDataMapper,
  autoCompleteDataMapper,
  homeDataMapper,
  modulesDataMapper,
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

const homeController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.languages;
  const url = `${config.saavn.baseUrl}?__call=${config.saavn.endpoint.modules.home}`;

  const { data, code, error, message } = await fetchGet(url, {
    params: {
      ...params,
    },
    headers: {
      cookie: `L=${languages || 'hindi,punjabi'}; gdpr_acceptance=true; DL=english`,
    },
  });

  const sanitizedData = homeDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error, rawData: data });
};

const modulesController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.languages;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      ...params,
      __call: config.saavn.endpoint.modules.browse_modules,
    },
    headers: {
      cookie: `L=${languages || 'hindi'}; gdpr_acceptance=true; DL=english`,
    },
  });
  const sanitizedData = modulesDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const albumRecommendationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { albumId } = req.params;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.album.recommended,
      albumid: albumId,
      type: 'album',
      includeMetaTags: 0,
      ...params,
    },
  });
  const sanitizedData = recommendedAlbumDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const topAlbumsOfYearController = async (req: SaavnRequest, res: FastifyReply) => {
  const { year } = req.params;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.album.top_albums_by_year,
      album_year: year,
      ...params,
    },
  });

  const sanitizedData = recommendedAlbumDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const albumController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { albumId } = req.params;
    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.album.token,
        token: albumId,
        type: 'album',
        includeMetaTags: 0,
        ...params,
      },
    });
    const sanitizedData: any = albumDataMapper(data);
    const promiseArr = sanitizedData.modules.map((d) => {
      return {
        title: d.heading,
        promise: fetchGet(url, {
          params: {
            __call: d.endpoint,
            albumid: d.albumId,
            album_year: d.year,
            type: d.type,
            language: d.language,
            ...params,
          },
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value.data)
          ? {
              heading: promiseArr[index].title,
              data: isValidArray(result.value.data)
                ? recommendedAlbumDataMapper(result.value.data)
                : undefined,
            }
          : null,
      )
      .filter((d: any) => d != null);
    res.code(code).send({
      code,
      message,
      data: { album: sanitizedData.album, sections, data },
      error,
    });
  } catch (error) {
    res.code(400).send({
      data: null,
      code: 400,
      message: 'failed to fetch',
      error,
    });
  }
};

const playlistController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { playlistId } = req.params;
    const { page = 0, count = 50 } = req.query;
    const url = `${config.saavn.baseUrl}`;
    const { data, code, error, message } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.playlist.token,
        token: playlistId,
        type: 'playlist',
        includeMetaTags: 0,
        n: count,
        p: page,
        ...params,
      },
    });
    const sanitizedData: any = albumDataMapper(data);
    const promiseArr = sanitizedData.modules.map((d) => {
      return {
        title: d.heading,
        promise: fetchGet(url, {
          params: {
            __call: d.endpoint,
            listid: d.listId,
            entity_type: d.type,
            entity_language: d.language,
            ...params,
          },
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value.data)
          ? {
              heading: promiseArr[index].title,
              data: isValidArray(result.value.data)
                ? recommendedAlbumDataMapper(result.value.data)
                : undefined,
            }
          : null,
      )
      .filter((d: any) => d != null);
    res.code(code).send({
      code,
      message,
      data: { album: sanitizedData.album, sections },
      error,
    });
  } catch (error) {
    res.code(400).send({
      data: null,
      code: 400,
      message: 'failed to fetch',
      error,
    });
  }
};

const mixController = async (req: SaavnRequest, res: FastifyReply) => {
  const { mixId } = req.params;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.playlist.token,
      token: mixId,
      type: 'mix',
      p: 1, // TODO: Fix this Page
      n: 100, // TODO: Fix this count
      includeMetaTags: 0,
      ...params,
    },
  });
  const sanitizedData = await albumDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const stationController = async (req: SaavnRequest, res: FastifyReply) => {
  const { language, name } = req.query;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.radio.featured,
      language: language,
      name: name,
      includeMetaTags: 0,
      ...params,
    },
  });
  res.code(code).send({ code, message, data: data, error });
};

const stationSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  const { stationId, count } = req.query;
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.radio.songs,
      stationid: stationId,
      next: 1,
      k: count,
      ...params,
    },
  });
  const sanitizedData = await stationSongsMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const topSearchController = async (req: SaavnRequest, res: FastifyReply) => {
  const url = `${config.saavn.baseUrl}`;
  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.search.top_search,
      ...params,
    },
  });

  const sortedData = topSearchMapper(data);

  res.code(code).send({ code, message, data: sortedData, error });
};

const searchController = async (req: SaavnRequest, res: FastifyReply) => {
  // Explicitly type and normalize the query parameters
  const q = req.query.q as string;
  const type = ((req.query.type as string) || 'all').toLowerCase();
  const page = Number(req.query.page) || 1;
  const count = Number(req.query.count) || 30;

  let url = `${config.saavn.baseUrl}`;

  const { data, code, error, message } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.search[type],
      q,
      query: q,
      p: page,
      n: count,
      ...params,
      api_version: ['artist', 'all'].includes(type) ? 3 : 4,
    },
  });

  let sanitizedData;
  try {
    switch (type) {
      case 'albums':
        sanitizedData = {
          heading: 'Albums',
          list: (data as any).results.map((d) => albumDataMapper(d)),
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
          list: (data as any).results.map((d) => albumDataMapper(d)),
          source: 'saavn',
          count: (data as any).total,
        };
        break;
      case 'playlists':
        sanitizedData = {
          heading: 'Playlists',
          list: (data as any).results.map((d) => albumDataMapper(d)),
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
  }

  res.code(code).send({ code, message, data: sanitizedData, error });
};

const artistController = async (req: SaavnRequest, res: FastifyReply) => {
  const { artistId } = req.params;
  const { page = 0, count = 50 } = req.query;
  const url = `${config.saavn.baseUrl}`;

  const { data, code, message, error } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.artist.link,
      token: artistId,
      type: 'artist',
      p: page,
      n_song: count,
      n_album: count,
      ...params,
    },
  });
  const extractedData = artistDataMapper(data);
  res.code(200).send({ data: extractedData, code, message, error });
};

const songController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { songId } = req.params;
    const url = `${config.saavn.baseUrl}`;

    const { data, code, message, error } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.song.link,
        token: songId,
        type: 'song',
        ...params,
      },
    });

    console.log((data as any).songs[0].id);

    const { data: lyricsData } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.get.lyrics,
        lyrics_id: (data as any)?.songs[0]?.id,
        ...params,
      },
    });
    const songData = songsDetailsMapper(data);
    const promiseArr = songData.modules.map((d) => {
      return {
        title: d.heading,
        promise: fetchGet(url, {
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
        }),
      };
    });
    const results = await Promise.allSettled(promiseArr.map((item) => item.promise));

    const sections = results
      .map((result: any, index) =>
        isValidArray(result.value.data)
          ? {
              heading: promiseArr[index].title,
              data: isValidArray(result.value.data)
                ? result.value.data.map((d) => albumDataMapper(d))
                : undefined,
            }
          : null,
      )
      .filter((d: any) => d != null);

    res.code(200).send({
      data: {
        song: songData.song,
        sections: sections,
        lyrics: (lyricsData as any)?.lyrics || '',
      },
      code,
      message,
      error,
    });
  } catch (error) {
    res.code(400).send({
      data: null,
      code: 400,
      message: 'failed to fetch',
      error,
    });
  }
};

const recommendedSongsController = async (req: SaavnRequest, res: FastifyReply) => {
  try {
    const { songId } = req.params;
    const languages = req.query.languages;
    const url = `${config.saavn.baseUrl}`;

    const { data, code, message, error } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.song.recommended,
        pid: songId,
        language: languages,
        ...params,
        ctx: 'wap6dot0',
      },
    });
    const sanitizedData = songDataSanitizer(data);
    res.code(code).send({ code, message, data: sanitizedData, error });
  } catch (error) {
    res.code(400).send({
      data: null,
      code: 400,
      message: 'failed to fetch',
      error,
    });
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
