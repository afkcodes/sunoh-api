import { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';

const index = (fastify: FastifyInstance, _opts: FastifyServerOptions, done: any) => {
  fastify.get('/', (request: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({ hello: 'world' });
  });

  done();
};

export default index;
