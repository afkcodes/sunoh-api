import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import { play } from './play';
import { proxyImage } from './proxyImage';
import { saavnRoutes } from './saavn/route';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.get('/proxy', proxyImage);
  fastify.get('/play', play);
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(gaanaRoutes, { prefix: '/gaana' });
  // fastify.register(youtubeRoutes, { prefix: '/ytm' });

  done();
};

export default entry;
