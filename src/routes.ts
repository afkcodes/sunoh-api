import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const userRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ hello: 'routes' });
  });
};

export default userRoutes;
