import { FastifyInstance, FastifyServerOptions } from 'fastify';
import { saavnRoutes } from './saavn/route';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  fastify.register(saavnRoutes, { prefix: '/saavn' });
  done();
};

export default entry;
