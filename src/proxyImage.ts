import { FastifyReply, FastifyRequest } from 'fastify';

type ProxyRequest = FastifyRequest<{
  Querystring: {
    url: string;
  };
}>;

const proxyImage = async (request: ProxyRequest, reply: FastifyReply) => {
  const { url } = request.query;

  if (!url) {
    reply.code(400).send({ error: 'URL parameter is required' });
    return;
  }

  try {
    const imageResponse = await fetch(url);

    if (!imageResponse.ok) {
      reply.code(imageResponse.status).send({ error: 'Failed to fetch image' });
      return;
    }

    const contentType = imageResponse.headers.get('content-type');
    const imageBuffer = await imageResponse.arrayBuffer();

    reply.code(200).header('Content-Type', contentType).send(Buffer.from(imageBuffer));
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error' });
  }
};

export { proxyImage };
