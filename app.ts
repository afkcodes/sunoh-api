import { FastifyInstance, FastifyServerOptions } from 'fastify';
import userRoutes from './src/routes';

export default async function (fastify: FastifyInstance, _opts: FastifyServerOptions, done: any) {
  fastify.register(userRoutes)
  done();
}
