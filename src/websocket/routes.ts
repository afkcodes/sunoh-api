import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError, sendSuccess } from '../utils/response';
import { LiveMusicWebSocketManager } from './liveMusicManager';

let liveMusicManager: LiveMusicWebSocketManager | null = null;

export function initializeLiveMusicWebSocket(server: any) {
  liveMusicManager = new LiveMusicWebSocketManager(server);
  return liveMusicManager;
}

export function getLiveMusicManager(): LiveMusicWebSocketManager | null {
  return liveMusicManager;
}

// Live music API routes
export async function liveMusicRoutes(fastify: FastifyInstance) {
  // Get live music stats
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return sendError(reply, 'WebSocket server not initialized', null, 503);
    }

    const stats = liveMusicManager.getStats();
    return sendSuccess(reply, stats, 'Live music stats fetched', 'websocket');
  });

  // Get recent activities
  fastify.get('/activities', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return sendError(reply, 'WebSocket server not initialized', null, 503);
    }

    const activities = liveMusicManager.getRecentActivitiesForAPI();
    return sendSuccess(
      reply,
      {
        activities,
        count: activities.length,
      },
      'Recent activities fetched',
      'websocket',
    );
  });

  // Get connected users
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return sendError(reply, 'WebSocket server not initialized', null, 503);
    }

    const users = liveMusicManager.getConnectedUsersForAPI();
    return sendSuccess(
      reply,
      {
        users,
        count: users.length,
      },
      'Connected users fetched',
      'websocket',
    );
  });

  // Health check for live music service
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const isHealthy = liveMusicManager !== null;
    const data = {
      service: 'live-music-websocket',
      status: isHealthy ? 'healthy' : 'unavailable',
    };

    if (isHealthy) {
      return sendSuccess(reply, data, 'Service is healthy', 'websocket');
    }
    return sendError(reply, 'Service is unavailable', data, 503);
  });

  // Get active jam sessions
  fastify.get('/jam-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return sendError(reply, 'WebSocket server not initialized', null, 503);
    }

    const jamSessions = liveMusicManager.getJamSessionsForAPI();
    return sendSuccess(
      reply,
      {
        jamSessions,
        count: jamSessions.length,
      },
      'Active jam sessions fetched',
      'websocket',
    );
  });

  // Get specific jam session
  fastify.get(
    '/jam-sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!liveMusicManager) {
        return sendError(reply, 'WebSocket server not initialized', null, 503);
      }

      const jamSession = liveMusicManager.getJamSessionByIdForAPI(request.params.id);
      if (!jamSession) {
        return sendError(reply, 'Jam session not found', null, 404);
      }

      return sendSuccess(reply, jamSession, 'Jam session details fetched', 'websocket');
    },
  );
}
