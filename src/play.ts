import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config/config';
import { fetchGet } from './helpers/http';
import { songDataSanitizer } from './saavn/helper';
import { sendError, sendSuccess } from './utils/response';

type PlayRequest = FastifyRequest<{
  Querystring: {
    id: string;
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
  try {
    const { id } = req.query;
    if (!id) {
      return sendError(res, 'Missing song ID', null, 400);
    }

    const url = `${config.saavn.baseUrl}`;
    const { data, error, message } = await fetchGet(url, {
      params: {
        __call: config.saavn.endpoint.song.link,
        token: id,
        type: 'song',
        ...params,
      },
    });

    if (error || !data) {
      return sendError(res, message || 'Failed to fetch song for playback', error);
    }

    const media = songDataSanitizer((data as any).songs);

    return sendSuccess(res, media, 'Fetched media successfully', 'saavn');
  } catch (error) {
    return sendError(res, 'Playback error', error);
  }
};

export { play };
