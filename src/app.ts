import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from "fastify";

export default async function (
  fastify: FastifyInstance,
  _opts: FastifyServerOptions,
  done: any
) {
  fastify.get("/", (request: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({ hello: "world" });
  });

  done();
}
