import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        stats: null,
      });
    }

    const stats = liveMusicManager.getStats();
    return {
      success: true,
      stats,
      timestamp: Date.now(),
    };
  });

  // Get recent activities
  fastify.get('/activities', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        activities: [],
      });
    }

    const activities = liveMusicManager.getRecentActivitiesForAPI();
    return {
      success: true,
      activities,
      count: activities.length,
      timestamp: Date.now(),
    };
  });

  // Get connected users
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        users: [],
      });
    }

    const users = liveMusicManager.getConnectedUsersForAPI();
    return {
      success: true,
      users,
      count: users.length,
      timestamp: Date.now(),
    };
  });

  // Health check for live music service
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const isHealthy = liveMusicManager !== null;

    return reply.code(isHealthy ? 200 : 503).send({
      success: isHealthy,
      service: 'live-music-websocket',
      status: isHealthy ? 'healthy' : 'unavailable',
      timestamp: Date.now(),
    });
  });

  // Get active jam sessions
  fastify.get('/jam-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        jamSessions: [],
      });
    }

    const jamSessions = liveMusicManager.getJamSessionsForAPI();
    return {
      success: true,
      jamSessions,
      count: jamSessions.length,
      timestamp: Date.now(),
    };
  });

  // Get specific jam session
  fastify.get(
    '/jam-sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!liveMusicManager) {
        return reply.code(503).send({
          error: 'WebSocket server not initialized',
          jamSession: null,
        });
      }

      const jamSession = liveMusicManager.getJamSessionByIdForAPI(request.params.id);
      if (!jamSession) {
        return reply.code(404).send({
          error: 'Jam session not found',
          jamSession: null,
        });
      }

      return {
        success: true,
        jamSession,
        timestamp: Date.now(),
      };
    },
  );
}
