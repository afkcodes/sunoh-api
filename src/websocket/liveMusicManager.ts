import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
import {
  LiveMusicActivity,
  ConnectedUser,
  WebSocketMessage,
  WebSocketResponse,
  LiveMusicStats
} from './types';

// Helper function to generate unique IDs
function generateId(): string {
  return randomBytes(16).toString('hex');
}

interface ClientConnection {
  ws: WebSocket;
  user: ConnectedUser;
}

export class LiveMusicWebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection> = new Map();
  private activities: LiveMusicActivity[] = [];
  private readonly maxActivities = 1000;
  private readonly maxRecentActivities = 50;
  private cleanupInterval: NodeJS.Timeout;
  private heartbeatInterval: NodeJS.Timeout;
  private startTime: number;

  constructor(server: any) {
    this.startTime = Date.now();
    
    // Create WebSocket server
    this.wss = new WebSocketServer({
      server,
      path: '/ws/live-music',
    });

    console.log('🎵 Live Music WebSocket server initialized on /ws/live-music');

    // Handle connections
    this.wss.on('connection', this.handleConnection.bind(this));

    // Start cleanup and heartbeat intervals
    this.startIntervals();
  }

  private startIntervals() {
    // Cleanup inactive clients every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveClients();
    }, 30000);

    // Send heartbeat every 25 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = generateId();
    
    console.log(`🔗 New WebSocket connection: ${clientId}`);

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        this.handleMessage(clientId, ws, message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnection(clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.handleDisconnection(clientId);
    });

    // Send initial connection response
    this.sendMessage(ws, {
      type: 'connected',
      clientId,
      timestamp: Date.now(),
    });
  }

  private handleMessage(clientId: string, ws: WebSocket, message: WebSocketMessage) {
    switch (message.type) {
      case 'connect':
        this.handleUserConnect(clientId, ws, message.username!);
        break;

      case 'activity':
        this.handleActivityMessage(clientId, message);
        break;

      case 'ping':
      case 'heartbeat':
        this.handleHeartbeat(clientId);
        break;

      case 'disconnect':
        this.handleDisconnection(clientId);
        break;

      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleUserConnect(clientId: string, ws: WebSocket, username: string) {
    if (!username || username.trim().length === 0) {
      this.sendError(ws, 'Username is required');
      return;
    }

    // Check if username is already taken
    const existingUser = Array.from(this.clients.values()).find(
      client => client.user.username.toLowerCase() === username.toLowerCase()
    );

    if (existingUser) {
      console.log(`👤 Disconnecting existing user ${username} for new connection`);
      
      // Send disconnect message to existing client
      if (existingUser.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(existingUser.ws, {
          type: 'error',
          error: 'You have been disconnected due to a new login',
          timestamp: Date.now(),
        });
        existingUser.ws.close(1000, 'New connection');
      }
      
      // Remove existing client
      this.clients.delete(existingUser.user.id);
    }

    const user: ConnectedUser = {
      id: clientId,
      username: username.trim(),
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    };

    const connection: ClientConnection = {
      ws,
      user,
    };

    this.clients.set(clientId, connection);

    console.log(`👤 User connected: ${username} (${clientId})`);

    // Send success response with recent activities and connected users
    this.sendMessage(ws, {
      type: 'connected',
      username,
      recentActivities: this.getRecentActivities(),
      connectedUsers: this.getConnectedUsers(),
      timestamp: Date.now(),
    });

    // Notify other clients about new user
    this.broadcastToOthers(clientId, {
      type: 'user_joined',
      username,
      connectedUsers: this.getConnectedUsers(),
      timestamp: Date.now(),
    });
  }

  private handleActivityMessage(clientId: string, message: WebSocketMessage) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.activity) {
      return;
    }

    // Create full activity object
    const activity: LiveMusicActivity = {
      id: generateId(),
      username: connection.user.username,
      song: message.activity.song,
      action: message.activity.action,
      timestamp: Date.now(),
    };

    // Store activity
    this.addActivity(activity);

    // Update user's last activity
    connection.user.lastActivity = Date.now();

    console.log(
      `🎵 Activity from ${connection.user.username}: ${activity.action} - ${activity.song.title} by ${activity.song.artist}`
    );

    // Broadcast to all clients (including sender)
    this.broadcastToAll({
      type: 'activity',
      activity,
      timestamp: Date.now(),
    });
  }

  private handleHeartbeat(clientId: string) {
    const connection = this.clients.get(clientId);
    if (connection) {
      connection.user.lastActivity = Date.now();
      this.sendMessage(connection.ws, { 
        type: 'pong',
        timestamp: Date.now(),
      });
    }
  }

  private handleDisconnection(clientId: string) {
    const connection = this.clients.get(clientId);
    if (connection) {
      console.log(`👋 User disconnected: ${connection.user.username} (${clientId})`);
      
      const username = connection.user.username;
      this.clients.delete(clientId);

      // Notify other clients about user leaving
      this.broadcastToOthers(clientId, {
        type: 'user_left',
        username,
        connectedUsers: this.getConnectedUsers(),
        timestamp: Date.now(),
      });
    }
  }

  private addActivity(activity: LiveMusicActivity) {
    // Add to beginning of array (most recent first)
    this.activities.unshift(activity);

    // Keep only recent activities
    if (this.activities.length > this.maxActivities) {
      this.activities = this.activities.slice(0, this.maxActivities);
    }
  }

  private getRecentActivities(): LiveMusicActivity[] {
    // Return activities from last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return this.activities
      .filter((activity) => activity.timestamp > oneDayAgo)
      .slice(0, this.maxRecentActivities);
  }

  private getConnectedUsers(): ConnectedUser[] {
    return Array.from(this.clients.values()).map(connection => ({
      ...connection.user
    }));
  }

  private broadcastToOthers(excludeClientId: string, message: WebSocketResponse) {
    this.clients.forEach((connection, clientId) => {
      if (clientId !== excludeClientId && connection.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(connection.ws, message);
      }
    });
  }

  private broadcastToAll(message: WebSocketResponse) {
    this.clients.forEach((connection) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(connection.ws, message);
      }
    });
  }

  private sendMessage(ws: WebSocket, message: WebSocketResponse) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
      }
    }
  }

  private sendError(ws: WebSocket, error: string) {
    this.sendMessage(ws, {
      type: 'error',
      error,
      timestamp: Date.now(),
    });
  }

  private sendHeartbeat() {
    this.broadcastToAll({
      type: 'heartbeat',
      timestamp: Date.now(),
    });
  }

  private cleanupInactiveClients() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    this.clients.forEach((connection, clientId) => {
      if (now - connection.user.lastActivity > timeout) {
        console.log(`🧹 Cleaning up inactive client: ${connection.user.username} (${clientId})`);
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
        this.clients.delete(clientId);
      }
    });
  }

  // Public methods for stats and management
  getStats(): LiveMusicStats {
    return {
      connectedClients: this.clients.size,
      totalActivities: this.activities.length,
      recentActivities: this.getRecentActivities().length,
      activeUsers: this.getConnectedUsers(),
      uptime: Date.now() - this.startTime,
    };
  }

  getRecentActivitiesForAPI(): LiveMusicActivity[] {
    return this.getRecentActivities();
  }

  getConnectedUsersForAPI(): ConnectedUser[] {
    return this.getConnectedUsers();
  }

  // Cleanup method
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Close all connections
    this.clients.forEach((connection) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close();
      }
    });

    this.wss.close();
    console.log('🔌 Live Music WebSocket server closed');
  }
}
