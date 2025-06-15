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
        stats: null
      });
    }

    const stats = liveMusicManager.getStats();
    return {
      success: true,
      stats,
      timestamp: Date.now()
    };
  });

  // Get recent activities
  fastify.get('/activities', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        activities: []
      });
    }

    const activities = liveMusicManager.getRecentActivitiesForAPI();
    return {
      success: true,
      activities,
      count: activities.length,
      timestamp: Date.now()
    };
  });

  // Get connected users
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!liveMusicManager) {
      return reply.code(503).send({
        error: 'WebSocket server not initialized',
        users: []
      });
    }

    const users = liveMusicManager.getConnectedUsersForAPI();
    return {
      success: true,
      users,
      count: users.length,
      timestamp: Date.now()
    };
  });

  // Health check for live music service
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const isHealthy = liveMusicManager !== null;
    
    return reply.code(isHealthy ? 200 : 503).send({
      success: isHealthy,
      service: 'live-music-websocket',
      status: isHealthy ? 'healthy' : 'unavailable',
      timestamp: Date.now()
    });
  });
}
