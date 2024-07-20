import { FastifyInstance, FastifyServerOptions } from 'fastify';

const entry = (fastify: FastifyInstance, _opts: FastifyServerOptions, done: any) => {
  fastify.get('/', async () => ({ status: 'OK' }));
  done();
};

export default entry;
