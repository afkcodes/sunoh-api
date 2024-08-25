import { FastifyReply, FastifyRequest } from 'fastify';
// import * as muse from 'libmuse';

// muse.setup({
//   location: 'IN',
// });

// or for TS / ES6

const ytHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  // const data = await muse.get_home({ limit: 10 });
  // const extractedData = ytHomeDataExtractor(data);
  // res.code(200).send(extractedData);
};

export { ytHomeController };
