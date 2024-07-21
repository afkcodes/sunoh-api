import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { fetchGet } from '../helpers/http';
import { homeDataMapper, modulesDataMapper } from './helper';

type SaavnRequest = FastifyRequest<{
  Querystring: {
    languages: string;
  };
  Params: { titleid: string };
}>;

const homeController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.languages;
  const url = `${config.saavn.baseUrl}?__call=${config.saavn.endpoint.modules.home}&api_version=${config.saavn.api_version}&_format=${config.saavn._format}&_marker=${config.saavn._marker}&ctx=${config.saavn.ctx}`;

  const { data, code, error, message } = await fetchGet(url, {
    headers: {
      cookie: `L=${languages ? languages : 'hindi'}; gdpr_acceptance=true; DL=english`,
    },
  });
  const sanitizedData = homeDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const modulesController = async (req: SaavnRequest, res: FastifyReply) => {
  const languages = req.query.languages;
  const url = `${config.saavn.baseUrl}?__call=${config.saavn.endpoint.modules.browse_modules}&api_version=${config.saavn.api_version}&_format=${config.saavn._format}&_marker=${config.saavn._marker}&ctx=${config.saavn.ctx}`;
  const { data, code, error, message } = await fetchGet(url, {
    headers: {
      cookie: `L=${languages ? languages : 'hindi'}; gdpr_acceptance=true; DL=english`,
    },
  });
  const sanitizedData = modulesDataMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

export { homeController, modulesController };
