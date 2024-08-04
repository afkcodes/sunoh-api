import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { gaanaRoutes } from './gaana/route';
import { saavnRoutes } from './saavn/route';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  fastify.register(gaanaRoutes, { prefix: '/gaana' });

  done();
};

export default entry;
