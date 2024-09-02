import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config/config';
import { fetchGet } from './helpers/http';
import { songDataSanitizer } from './saavn/helper';

type PlayRequest = FastifyRequest<{
  Querystring: {
    id: string;
    source: 'saavn' | 'gaana' | 'ytm';
    q: 'low' | 'medium' | 'high';
  };
}>;

const params = {
  api_version: config.saavn.api_version,
  _format: config.saavn._format,
  _marker: config.saavn._marker,
  ctx: config.saavn.ctx,
};

const play = async (req: PlayRequest, res: FastifyReply) => {
  const qmap = {
    high: '320kbps',
    low: '96kbps',
    medium: '160kbps',
  };
  const { id, source, q } = req.query;
  const url = `${config.saavn.baseUrl}`;
  const { data } = await fetchGet(url, {
    params: {
      __call: config.saavn.endpoint.song.link,
      token: id,
      type: 'song',
      ...params,
    },
  });

  const media = songDataSanitizer((data as any).songs) as any;

  res.code(200).send({ data: media, source, code: 200, message: 'fetched media successfully' });
};

export { play };
