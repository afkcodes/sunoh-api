import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { fetchGet } from '../helpers/http';
import { albumDataMapper, homeDataMapper, modulesDataMapper } from './helper';

type SaavnRequest = FastifyRequest<{
  Querystring: {
    languages: string;
  };
  Params: { albumId: string };
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
      __call: 'webapi.get',
      token: albumId,
      type: 'album',
      includeMetaTags: 0,
      ...params,
    },
  });
  const sanitizedData = albumDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

export { albumController, homeController, modulesController };
