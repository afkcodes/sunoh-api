import { FastifyInstance } from 'fastify';
import {
  getAirStationsController,
  getUnifiedRadioHomeController,
  searchRadioStationsController,
} from './controller';

export const radioRoutes = async (fastify: FastifyInstance) => {
  // Get unified radio home (sections)
  fastify.get('/home', getUnifiedRadioHomeController);

  // Get all AIR stations
  fastify.get('/air', getAirStationsController);

  // Search radio stations
  fastify.get('/search', searchRadioStationsController);
};
