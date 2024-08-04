import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { fetchPost } from '../helpers/http';
import { radioDataMapper, radioDetailMapper } from './helper';

type GaanaRequest = FastifyRequest<{
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
    radioId: string;
    trackId: string;
  };
}>;

const radioController = async (req: GaanaRequest, res: FastifyReply) => {
  const { page = 0 } = req.query;
  const { data, code, message, error } = await fetchPost(`${config.gaana.baseUrl}`, {
    params: {
      type: config.gaana.radio.popular,
      page: page,
    },
  });

  const sanitizedData = radioDataMapper(data, page);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const radioDetailController = async (req: GaanaRequest, res: FastifyReply) => {
  const { radioId } = req.params;
  console.log(radioId);
  const { data, code, message, error } = await fetchPost(`${config.gaana.baseUrl}`, {
    params: {
      type: config.gaana.radio.detail,
      id: radioId,
    },
  });

  const sanitizedData = await radioDetailMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const trackController = async (req: GaanaRequest, res: FastifyReply) => {
  const { trackId } = req.params;
  const deviceId = '90fa4b38-4aaa-4612-89e6-517af208fee6';
  const hashInput = `${trackId}|${deviceId}|03:40:31 sec`;
  let hash = crypto.createHash('md5').update(hashInput).digest('hex');
  hash += deviceId.slice(3, 9) + '=';

  const { data, code, message, error } = await fetchPost(`${config.gaana.streamTrack}`, {
    formData: {
      track_id: trackId,
      quality: 'high',
      ht: hash,
      ps: deviceId,
      st: 'hls',
      request_type: 'web',
    },
  });

  res.code(code).send({ code, message, data: (data as any).stream_path, error });
};

export { radioController, radioDetailController, trackController };
