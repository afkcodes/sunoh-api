import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { fetchGet } from '../helpers/http';
import {
  albumDataWithPalette,
  homeDataMapper,
  modulesDataMapper,
  recommendedAlbumDataMapper,
  stationSongsMapper,
} from './helper';

type SaavnRequest = FastifyRequest<{
  Querystring: {
    languages: string;
    language: string;
    page: number;
    count: number;
    name: string;
    stationId: string;
  };
  Params: {
    albumId: string;
    year: string;
    playlistId: string;
    mixId: string;
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
      cookie: `L=${languages || 'hindi'}; gdpr_acceptance=true; DL=english`,
    },
  });
  const sanitizedData = homeDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
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

const albumController = async (req: SaavnRequest, res: FastifyReply) => {
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
  const sanitizedData = await albumDataWithPalette(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const albumRecommendationController = async (req: SaavnRequest, res: FastifyReply) => {
  console.log(req.params);
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

const playlistController = async (req: SaavnRequest, res: FastifyReply) => {
  const { playlistId } = req.params;
  const { page = 1, count = 50 } = req.query;
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
  const sanitizedData = await albumDataWithPalette(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
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
  const sanitizedData = await albumDataWithPalette(data);
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
  console.log(stationId, count);
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

export {
  albumController,
  albumRecommendationController,
  homeController,
  mixController,
  modulesController,
  playlistController,
  stationController,
  stationSongsController,
  topAlbumsOfYearController,
};
