import { FastifyReply, FastifyRequest } from 'fastify';
import { sendError, sendSuccess } from '../utils/response';
import * as radioService from './service';

/**
 * Get official AIR stations
 */
export const getAirStationsController = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const stations = await radioService.getStationsByProvider('air', 300);
    return sendSuccess(res, stations, 'AIR stations fetched successfully');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch AIR stations');
  }
};

/**
 * Search radio stations using database
 */
export const searchRadioStationsController = async (req: FastifyRequest, res: FastifyReply) => {
  const { q, query, limit = 20, genre, provider } = req.query as any;
  const searchQuery = q || query || '';

  try {
    const stations = await radioService.searchStations({
      query: searchQuery,
      genre,
      provider,
      limit: parseInt(limit),
    });

    const formattedStations = stations.map((s) => ({
      ...s,
      url: s.stream_url, // For backward compatibility with previous unified format
      type: 'radio',
    }));

    return sendSuccess(res, formattedStations, 'Radio stations searched successfully');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to search radio stations');
  }
};

/**
 * Get unified radio home data
 */
export const getUnifiedRadioHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // 1. Get Official AIR Stations
    const airStations = await radioService.getStationsByProvider('air', 10);

    // 2. Get Popular Working FM Stations
    const popularStations = await radioService.searchStations({
      provider: 'onlineradiobox',
      limit: 20,
    });

    const sections = [
      {
        heading: 'Official AIR Stations',
        data: airStations.map((s) => ({ ...s, url: s.stream_url, type: 'radio' })),
      },
      {
        heading: 'Popular FM Radio',
        data: popularStations.map((s) => ({ ...s, url: s.stream_url, type: 'radio' })),
      },
    ];

    return sendSuccess(res, sections, 'Radio home data fetched successfully');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch radio home data');
  }
};
