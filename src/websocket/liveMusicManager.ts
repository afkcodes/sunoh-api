import { randomBytes } from 'crypto';
import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ConnectedUser,
  JamSession,
  LiveMusicActivity,
  LiveMusicStats,
  WebSocketMessage,
  WebSocketResponse,
} from './types';

// Helper function to generate unique IDs
function generateId(): string {
  return randomBytes(16).toString('hex');
}

// Helper function to generate invite codes
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

interface ClientConnection {
  ws: WebSocket;
  user: ConnectedUser;
}

export class LiveMusicWebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection> = new Map();
  private jamSessions: Map<string, JamSession> = new Map();
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
    // Enhanced cleanup every 30 seconds for better responsiveness
    this.cleanupInterval = setInterval(() => {
      console.log(`🔍 Running cleanup check... (${this.clients.size} clients, ${this.jamSessions.size} sessions)`);
      // Clean up clients that are truly disconnected
      this.cleanupDisconnectedClients();
      // Only clean up sessions that have been empty for 1 hour
      this.cleanupIdleSessions();
    }, 30000); // More frequent cleanup for better responsiveness

    // Send heartbeat every 20 seconds for better connection monitoring
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 20000);
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
    // Update last activity for any message
    const connection = this.clients.get(clientId);
    if (connection) {
      connection.user.lastActivity = Date.now();
    }

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

      case 'jam_create':
        this.handleJamSessionCreate(clientId, ws, message);
        break;

      case 'jam_join':
        this.handleJamSessionJoin(clientId, ws, message);
        break;

      case 'jam_join_with_code':
        this.handleJamSessionJoinWithCode(clientId, ws, message);
        break;

      case 'jam_leave':
        this.handleJamSessionLeave(clientId, ws, message);
        break;

      case 'jam_add_to_queue':
        this.handleJamAddToQueue(clientId, ws, message);
        break;

      case 'jam_update_state':
        this.handleJamUpdateState(clientId, ws, message);
        break;

      case 'jam_sync_request':
        this.handleJamSyncRequest(clientId, ws, message);
        break;

      case 'jam_next_track':
        this.handleJamNextTrack(clientId, ws, message);
        break;

      case 'jam_remove_from_queue':
        this.handleJamRemoveFromQueue(clientId, ws, message);
        break;

      case 'jam_reorder_queue':
        this.handleJamReorderQueue(clientId, ws, message);
        break;

      case 'jam_kick_participant':
        this.handleJamKickParticipant(clientId, ws, message);
        break;

      case 'jam_update_queue_from_local':
        this.handleJamUpdateQueueFromLocal(clientId, ws, message);
        break;

      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleUserConnect(clientId: string, ws: WebSocket, username: string) {
    if (!username || username.trim().length === 0) {
      this.sendError(ws, 'Username is required');
      return;
    }

    // Check for reconnection opportunities first
    let reconnectionSession: JamSession | null = null;
    let wasHost = false;

    // Look for sessions where this username was a disconnected participant
    for (const [sessionId, jamSession] of this.jamSessions.entries()) {
      if (jamSession.disconnectedParticipants) {
        for (const [oldClientId, disconnectedUser] of Object.entries(jamSession.disconnectedParticipants)) {
          if (disconnectedUser.username.toLowerCase() === username.toLowerCase()) {
            // Check if disconnection was recent (within 24 hours)
            const disconnectTime = disconnectedUser.disconnectedAt;
            const reconnectWindow = 24 * 60 * 60 * 1000; // 24 hours
            
            if (Date.now() - disconnectTime < reconnectWindow) {
              reconnectionSession = jamSession;
              wasHost = disconnectedUser.wasHost;
              
              // Remove from disconnected participants
              delete jamSession.disconnectedParticipants[oldClientId];
              
              console.log(`🔄 User ${username} can reconnect to session: ${jamSession.name} (was ${wasHost ? 'host' : 'participant'})`);
              break;
            }
          }
        }
      }
      if (reconnectionSession) break;
    }

    // Check if username is already taken by a currently connected user
    const existingUser = Array.from(this.clients.values()).find(
      (client) => client.user.username.toLowerCase() === username.toLowerCase()
    );

    if (existingUser) {
      console.log(`👤 Disconnecting existing user ${username} for new connection`);

      // Handle jam session cleanup for the existing connection
      this.handleJamSessionCleanupForClient(existingUser.user.id);

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

    // Handle reconnection to jam session if available
    if (reconnectionSession) {
      // Add user back to the session
      reconnectionSession.participants.push(clientId);
      
      // Restore host status if they were the host
      if (wasHost) {
        // Check if there's currently no active host or if current host was temporary
        const currentHost = this.clients.get(reconnectionSession.hostId);
        const shouldRestoreHost = !currentHost || 
          (reconnectionSession.disconnectedParticipants && 
           Object.values(reconnectionSession.disconnectedParticipants).some(d => d.wasHost));
        
        if (shouldRestoreHost) {
          // Remove host status from current temporary host if any
          if (currentHost) {
            currentHost.user.isJamSessionHost = false;
          }
          
          // Restore original host
          reconnectionSession.hostId = clientId;
          reconnectionSession.hostUsername = username;
          user.isJamSessionHost = true;
          
          console.log(`👑 Restored host status to: ${username}`);
        }
      }
      
      // Update user's jam session data
      user.joinedJamSessionId = reconnectionSession.id;
      
      // Update the session
      this.jamSessions.set(reconnectionSession.id, reconnectionSession);

      console.log(`🔄 Successfully reconnected ${username} to session: ${reconnectionSession.name}`);
    }

    // Send success response with recent activities and connected users
    const response: any = {
      type: 'connected',
      username,
      recentActivities: this.getRecentActivities(),
      connectedUsers: this.getConnectedUsers(),
      timestamp: Date.now(),
    };

    // If user was reconnected to a session, include that information
    if (reconnectionSession) {
      response.jamSession = reconnectionSession;
      response.type = 'jam_reconnection_available';
      response.message = `Reconnected to session: ${reconnectionSession.name}`;
    }

    this.sendMessage(ws, response);

    // Notify other clients about new user
    this.broadcastToOthers(clientId, {
      type: 'user_joined',
      username,
      connectedUsers: this.getConnectedUsers(),
      timestamp: Date.now(),
    });

    // If user reconnected to a session, notify other session participants
    if (reconnectionSession) {
      this.broadcastToJamSessionParticipants(reconnectionSession.id, {
        type: 'jam_updated',
        jamSession: reconnectionSession,
        username,
        message: `${username} reconnected to the session`,
        timestamp: Date.now(),
      }, clientId);
    }

    // Broadcast updated jam sessions to all users
    this.broadcastJamSessions();
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
      // Optional: Send pong response
      this.sendMessage(connection.ws, {
        type: 'pong',
        timestamp: Date.now(),
      });
    }
  }

  private handleDisconnection(clientId: string) {
    const connection = this.clients.get(clientId);
    if (connection) {
      const inactiveTime = Date.now() - connection.user.lastActivity;
      console.log(`👋 User disconnected: ${connection.user.username} (${clientId}) - was inactive for ${Math.round(inactiveTime / 1000)}s`);

      const username = connection.user.username;

      // Handle jam session cleanup before removing client
      this.handleJamSessionCleanupForClient(clientId);

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
    return Array.from(this.clients.values()).map((connection) => ({
      ...connection.user,
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

  private cleanupDisconnectedClients() {
    // Clean up clients whose WebSocket connections are closed or in error state
    const clientsToRemove: string[] = [];
    
    this.clients.forEach((connection, clientId) => {
      const ws = connection.ws;
      const isDisconnected = ws.readyState === WebSocket.CLOSED || 
                           ws.readyState === WebSocket.CLOSING;
      
      // Also check for clients that haven't sent heartbeat in a while (network issues)
      const timeSinceLastActivity = Date.now() - connection.user.lastActivity;
      const isStale = timeSinceLastActivity > 120000; // 2 minutes without activity
      
      if (isDisconnected || isStale) {
        console.log(
          `🧹 Cleaning up ${isDisconnected ? 'disconnected' : 'stale'} client: ${connection.user.username} (${clientId}) - WebSocket state: ${ws.readyState}, last activity: ${Math.round(timeSinceLastActivity / 1000)}s ago`
        );
        clientsToRemove.push(clientId);
      }
    });

    // Remove disconnected/stale clients
    clientsToRemove.forEach(clientId => {
      const connection = this.clients.get(clientId);
      if (connection) {
        // Handle jam session cleanup before removing client
        this.handleJamSessionCleanupForClient(clientId);
        
        // Close WebSocket if still open
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close(1001, 'Client cleanup');
        }
        
        this.clients.delete(clientId);
      }
    });

    if (clientsToRemove.length > 0) {
      console.log(`🧹 Cleaned up ${clientsToRemove.length} disconnected/stale clients`);
    }
  }

  private cleanupStaleSessions() {
    // Additional check for sessions that appear active but have no truly connected participants
    const staleSessions: string[] = [];
    
    this.jamSessions.forEach((jamSession, sessionId) => {
      // Count truly active participants
      const activeParticipants = jamSession.participants.filter((participantId) => {
        const participant = this.clients.get(participantId);
        if (!participant) return false;
        
        const ws = participant.ws;
        const timeSinceLastActivity = Date.now() - participant.user.lastActivity;
        
        // Consider participant active if WebSocket is open and recent activity
        return ws.readyState === WebSocket.OPEN && timeSinceLastActivity < 120000; // 2 minutes
      });

      if (activeParticipants.length === 0) {
        console.log(`🧹 Found stale session with no active participants: ${jamSession.name}`);
        staleSessions.push(sessionId);
      }
    });

    // Clean up stale sessions
    staleSessions.forEach((sessionId) => {
      const session = this.jamSessions.get(sessionId);
      if (session) {
        console.log(`🧹 Cleaning up stale session: ${session.name}`);
        
        // Notify any remaining clients (if any) that session is ending
        session.participants.forEach((participantId) => {
          const participant = this.clients.get(participantId);
          if (participant && participant.ws.readyState === WebSocket.OPEN) {
            participant.user.joinedJamSessionId = undefined;
            participant.user.isJamSessionHost = false;
            
            this.sendMessage(participant.ws, {
              type: 'jam_left',
              error: 'Session was cleaned up due to inactivity',
              timestamp: Date.now(),
            });
          }
        });
        
        this.jamSessions.delete(sessionId);
      }
    });

    if (staleSessions.length > 0) {
      console.log(`🧹 Cleaned up ${staleSessions.length} stale sessions`);
      this.broadcastJamSessions();
    }
  }

  private cleanupIdleSessions() {
    // Only clean up sessions that have been empty (no connected participants) for 1 hour
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
    const sessionsToDelete: string[] = [];
    const now = Date.now();
    
    this.jamSessions.forEach((jamSession, sessionId) => {
      // Count currently connected participants
      const connectedParticipants = jamSession.participants.filter((participantId) => {
        const participant = this.clients.get(participantId);
        return participant && participant.ws.readyState === WebSocket.OPEN;
      });

      if (connectedParticipants.length === 0) {
        // Session is empty - check if it should be marked as empty or cleaned up
        if (!jamSession.lastEmptyTime) {
          // First time we detect this session is empty - mark it
          jamSession.lastEmptyTime = now;
          console.log(`⏰ Session "${jamSession.name}" is now empty, will be cleaned up in 1 hour if no one reconnects`);
          this.jamSessions.set(sessionId, jamSession);
        } else {
          // Check if it's been empty for more than 1 hour
          const emptyDuration = now - jamSession.lastEmptyTime;
          if (emptyDuration > oneHour) {
            console.log(`🧹 Session "${jamSession.name}" has been empty for ${Math.round(emptyDuration / 60000)} minutes, cleaning up`);
            sessionsToDelete.push(sessionId);
          }
        }
      } else {
        // Session has connected participants - clear the empty time
        if (jamSession.lastEmptyTime) {
          jamSession.lastEmptyTime = undefined;
          console.log(`✅ Session "${jamSession.name}" is no longer empty`);
          this.jamSessions.set(sessionId, jamSession);
        }
      }
    });

    // Delete idle sessions
    sessionsToDelete.forEach((sessionId) => {
      this.jamSessions.delete(sessionId);
    });

    if (sessionsToDelete.length > 0) {
      console.log(`🧹 Cleaned up ${sessionsToDelete.length} idle sessions`);
      this.broadcastJamSessions();
    }
  }

  private cleanupInactiveClients() {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes (increased from 5 minutes)

    this.clients.forEach((connection, clientId) => {
      if (now - connection.user.lastActivity > timeout) {
        console.log(
          `🧹 Cleaning up inactive client: ${connection.user.username} (${clientId}) - inactive for ${Math.round((now - connection.user.lastActivity) / 1000)}s`
        );

        // Handle jam session cleanup before removing client
        this.handleJamSessionCleanupForClient(clientId);

        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
        this.clients.delete(clientId);
      }
    });

    // Clean up empty jam sessions
    this.cleanupEmptyJamSessions();
  }

  private handleJamSessionCreate(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.jamSessionName) {
      this.sendError(ws, 'Invalid jam session create request');
      return;
    }

    // Check if user is already in a jam session
    if (connection.user.isJamSessionHost || connection.user.joinedJamSessionId) {
      this.sendError(ws, 'You are already part of a jam session');
      return;
    }

    const sessionId = generateId();
    const inviteCode = message.isPrivate ? generateInviteCode() : undefined;

    // Initialize queue with initial track if provided
    const initialQueue: LiveMusicActivity['song'][] = [];
    let currentSong: LiveMusicActivity['song'] | undefined;

    if (message.initialTrack) {
      // Convert MediaTrack to jam session song format
      const trackSong = {
        id: message.initialTrack.id,
        title: message.initialTrack.title,
        artist: message.initialTrack.artist || 'Unknown Artist',
        artwork: message.initialTrack.artwork || [],
        duration: message.initialTrack.duration || 0,
        token: message.initialTrack.source || message.initialTrack.id,
        rawData: message.initialTrack, // Store the complete MediaTrack for playback
      };
      initialQueue.push(trackSong);
      currentSong = trackSong;
    } else if (message.initialSong) {
      // Fallback for legacy initialSong format
      initialQueue.push(message.initialSong);
      currentSong = message.initialSong;
    }

    const jamSession: JamSession = {
      id: sessionId,
      name: message.jamSessionName,
      hostId: clientId,
      hostUsername: connection.user.username,
      createdAt: Date.now(),
      participants: [clientId],
      queue: initialQueue,
      currentSong,
      playbackState: (message.initialTrack || message.initialSong) ? 'playing' : 'paused',
      progress: 0,
      isPrivate: message.isPrivate || false,
      inviteCode,
    };

    // Update user as host
    connection.user.isJamSessionHost = true;
    connection.user.joinedJamSessionId = sessionId;
    connection.user.lastActivity = Date.now(); // Update activity when joining session

    // Store jam session
    this.jamSessions.set(sessionId, jamSession);

    console.log(
      `🎵 Jam session created: ${message.jamSessionName} by ${connection.user.username}${
        message.initialTrack
          ? ' with initial track: ' + message.initialTrack.title
          : message.initialSong
          ? ' with initial song: ' + message.initialSong.title
          : ''
      }`
    );

    // Notify the creator
    this.sendMessage(ws, {
      type: 'jam_created',
      jamSession,
      timestamp: Date.now(),
    });

    // Broadcast active jam sessions to all users
    this.broadcastJamSessions();
  }

  private handleJamSessionJoin(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.jamSessionId) {
      this.sendError(ws, 'Invalid jam session join request');
      return;
    }

    // Check if user is already in a jam session
    if (connection.user.isJamSessionHost || connection.user.joinedJamSessionId) {
      this.sendError(ws, 'You are already part of a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(message.jamSessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Check if session is private and requires invite code
    if (jamSession.isPrivate) {
      this.sendError(ws, 'This is a private session. Use invite code to join.');
      return;
    }

    // Add user to participants
    jamSession.participants.push(clientId);
    this.jamSessions.set(jamSession.id, jamSession);

    // Update user
    connection.user.joinedJamSessionId = jamSession.id;
    connection.user.lastActivity = Date.now(); // Update activity when joining session

    console.log(`👤 ${connection.user.username} joined jam session: ${jamSession.name}`);

    // Notify the user
    this.sendMessage(ws, {
      type: 'jam_joined',
      jamSession,
      timestamp: Date.now(),
    });

    // Notify host and other participants
    this.broadcastToJamSessionParticipants(
      jamSession.id,
      {
        type: 'jam_updated',
        jamSession,
        username: connection.user.username,
        timestamp: Date.now(),
      },
      clientId
    );
  }

  private handleJamSessionJoinWithCode(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.inviteCode) {
      this.sendError(ws, 'Invalid invite code join request');
      return;
    }

    // Check if user is already in a jam session
    if (connection.user.isJamSessionHost || connection.user.joinedJamSessionId) {
      this.sendError(ws, 'You are already part of a jam session');
      return;
    }

    // Find session by invite code
    let targetSession: JamSession | null = null;
    for (const [sessionId, jamSession] of this.jamSessions.entries()) {
      if (jamSession.inviteCode === message.inviteCode.toUpperCase()) {
        targetSession = jamSession;
        break;
      }
    }

    if (!targetSession) {
      this.sendError(ws, 'Invalid invite code');
      return;
    }

    // Add user to participants
    targetSession.participants.push(clientId);
    this.jamSessions.set(targetSession.id, targetSession);

    // Update user
    connection.user.joinedJamSessionId = targetSession.id;
    connection.user.lastActivity = Date.now(); // Update activity when joining session

    console.log(
      `👤 ${connection.user.username} joined private jam session: ${targetSession.name} using invite code`
    );

    // Notify the user
    this.sendMessage(ws, {
      type: 'jam_joined',
      jamSession: targetSession,
      timestamp: Date.now(),
    });

    // Notify host and other participants
    this.broadcastToJamSessionParticipants(
      targetSession.id,
      {
        type: 'jam_updated',
        jamSession: targetSession,
        username: connection.user.username,
        timestamp: Date.now(),
      },
      clientId
    );
  }

  private handleJamSessionLeave(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection) {
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      // Reset user's jam session data
      connection.user.joinedJamSessionId = undefined;
      connection.user.isJamSessionHost = false;
      return;
    }

    if (connection.user.isJamSessionHost) {
      // Host is leaving - end the session
      this.jamSessions.delete(sessionId);

      // Notify all participants that the session has ended
      for (const participantId of jamSession.participants) {
        const participant = this.clients.get(participantId);
        if (participant && participant.ws.readyState === WebSocket.OPEN) {
          // Reset participant's jam session data
          participant.user.joinedJamSessionId = undefined;
          participant.user.isJamSessionHost = false;

          // Notify participant
          this.sendMessage(participant.ws, {
            type: 'jam_left',
            username: connection.user.username,
            error: 'Host has ended the session',
            timestamp: Date.now(),
          });
        }
      }

      console.log(`🎵 Jam session ended: ${jamSession.name}`);
    } else {
      // Participant is leaving
      jamSession.participants = jamSession.participants.filter((id) => id !== clientId);
      this.jamSessions.set(sessionId, jamSession);

      // Reset user's jam session data
      connection.user.joinedJamSessionId = undefined;

      // Notify the user
      this.sendMessage(ws, {
        type: 'jam_left',
        timestamp: Date.now(),
      });

      // Notify host and other participants
      this.broadcastToJamSessionParticipants(sessionId, {
        type: 'jam_updated',
        jamSession,
        username: connection.user.username,
        timestamp: Date.now(),
      });

      console.log(`👤 ${connection.user.username} left jam session: ${jamSession.name}`);
    }

    // Broadcast updated jam sessions to all users
    this.broadcastJamSessions();
  }

  private handleJamAddToQueue(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.song) {
      this.sendError(ws, 'Invalid add to queue request');
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Check for duplicates before adding
    const songId = message.song.id;
    const songToken = message.song.token;
    const isDuplicate = jamSession.queue.some(
      (queueSong) => 
        queueSong.id === songId || 
        queueSong.token === songToken ||
        (queueSong.id === songToken && queueSong.token === songId)
    );

    if (isDuplicate) {
      this.sendError(ws, `"${message.song.title}" is already in the queue`);
      return;
    }

    // Add song to queue
    jamSession.queue.push(message.song);

    // If this is the first song and no song is currently playing, set it as current
    if (jamSession.queue.length === 1 && !jamSession.currentSong) {
      jamSession.currentSong = message.song;
    }

    this.jamSessions.set(sessionId, jamSession);

    console.log(
      `🎵 ${connection.user.username} added ${message.song.title} to jam session queue`
    );

    // Notify all participants about the updated queue
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_queue_updated',
      jamSession,
      queue: jamSession.queue,
      username: connection.user.username,
      timestamp: Date.now(),
    });
  }

  private handleJamUpdateState(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection) {
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can update the playback state
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can control playback');
      return;
    }

    // Update the jam session state
    if (message.playbackState) {
      jamSession.playbackState = message.playbackState;
    }

    if (message.progress !== undefined) {
      jamSession.progress = message.progress;
    }

    if (message.song) {
      jamSession.currentSong = message.song;
    }

    this.jamSessions.set(sessionId, jamSession);

    console.log(`🎵 Host updated jam session state: ${jamSession.playbackState}`);

    // Notify all participants
    this.broadcastToJamSessionParticipants(
      sessionId,
      {
        type: 'jam_state_updated',
        jamSession,
        playbackState: jamSession.playbackState,
        progress: jamSession.progress,
        song: jamSession.currentSong,
        timestamp: Date.now(),
      },
      clientId
    ); // Exclude sender to avoid echo
  }

  private handleJamSyncRequest(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection) {
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Send the current jam session state to the requesting client
    this.sendMessage(ws, {
      type: 'jam_sync_response',
      jamSession,
      queue: jamSession.queue,
      playbackState: jamSession.playbackState,
      progress: jamSession.progress,
      song: jamSession.currentSong,
      timestamp: Date.now(),
    });
  }

  private handleJamNextTrack(clientId: string, ws: WebSocket, message: WebSocketMessage) {
    const connection = this.clients.get(clientId);
    if (!connection) {
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can trigger next track
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can control playback');
      return;
    }

    // Find the current song in the queue and move to the next one
    const currentIndex = jamSession.queue.findIndex(
      (song) => song.id === jamSession.currentSong?.id
    );
    const nextIndex = currentIndex + 1;

    if (nextIndex < jamSession.queue.length) {
      // Move to next song in queue
      jamSession.currentSong = jamSession.queue[nextIndex];
      jamSession.progress = 0;
      jamSession.playbackState = 'playing';
    } else {
      // End of queue
      jamSession.currentSong = undefined;
      jamSession.progress = 0;
      jamSession.playbackState = 'paused';
    }

    this.jamSessions.set(sessionId, jamSession);

    console.log(`🎵 Host advanced to next track in jam session: ${jamSession.name}`);

    // Notify all participants about the track change
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_state_updated',
      jamSession,
      playbackState: jamSession.playbackState,
      progress: jamSession.progress,
      song: jamSession.currentSong,
      timestamp: Date.now(),
    });
  }

  private handleJamRemoveFromQueue(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || message.songIndex === undefined) {
      this.sendError(ws, 'Invalid remove from queue request');
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can remove songs from queue (or the person who added the song)
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can remove songs from queue');
      return;
    }

    const songIndex = message.songIndex;
    if (songIndex < 0 || songIndex >= jamSession.queue.length) {
      this.sendError(ws, 'Invalid song index');
      return;
    }

    // Cannot remove the currently playing song
    const songToRemove = jamSession.queue[songIndex];
    if (songToRemove?.id === jamSession.currentSong?.id) {
      this.sendError(ws, 'Cannot remove currently playing song');
      return;
    }

    // Remove the song from queue
    const removedSong = jamSession.queue.splice(songIndex, 1)[0];
    this.jamSessions.set(sessionId, jamSession);

    console.log(`🎵 Host removed ${removedSong.title} from jam session queue`);

    // Notify all participants about the updated queue
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_queue_updated',
      jamSession,
      queue: jamSession.queue,
      username: connection.user.username,
      timestamp: Date.now(),
    });
  }

  private handleJamReorderQueue(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || message.fromIndex === undefined || message.toIndex === undefined) {
      this.sendError(ws, 'Invalid reorder queue request');
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can reorder the queue
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can reorder the queue');
      return;
    }

    const fromIndex = message.fromIndex;
    const toIndex = message.toIndex;

    if (
      fromIndex < 0 ||
      fromIndex >= jamSession.queue.length ||
      toIndex < 0 ||
      toIndex >= jamSession.queue.length
    ) {
      this.sendError(ws, 'Invalid queue indices');
      return;
    }

    // Cannot move the currently playing song
    const draggedSong = jamSession.queue[fromIndex];
    const targetSong = jamSession.queue[toIndex];

    if (
      draggedSong?.id === jamSession.currentSong?.id ||
      targetSong?.id === jamSession.currentSong?.id
    ) {
      this.sendError(ws, 'Cannot reorder currently playing song');
      return;
    }

    // Reorder the queue
    const movedSong = jamSession.queue.splice(fromIndex, 1)[0];
    jamSession.queue.splice(toIndex, 0, movedSong);
    this.jamSessions.set(sessionId, jamSession);

    console.log(
      `🎵 Host reordered queue: moved ${movedSong.title} from ${fromIndex} to ${toIndex}`
    );

    // Notify all participants about the updated queue
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_queue_updated',
      jamSession,
      queue: jamSession.queue,
      username: connection.user.username,
      timestamp: Date.now(),
    });
  }

  private handleJamKickParticipant(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.participantId) {
      this.sendError(ws, 'Invalid kick participant request');
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can kick participants
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can kick participants');
      return;
    }

    const participantId = message.participantId;
    const participantConnection = this.clients.get(participantId);

    if (!participantConnection) {
      this.sendError(ws, 'Participant not found');
      return;
    }

    // Cannot kick the host
    if (participantId === jamSession.hostId) {
      this.sendError(ws, 'Cannot kick the host');
      return;
    }

    // Remove participant from session
    jamSession.participants = jamSession.participants.filter(
      (id) => id !== participantId
    );
    this.jamSessions.set(sessionId, jamSession);

    // Reset participant's jam session data
    participantConnection.user.joinedJamSessionId = undefined;

    // Notify the kicked participant
    this.sendMessage(participantConnection.ws, {
      type: 'jam_participant_kicked',
      error: 'You have been removed from the jam session',
      timestamp: Date.now(),
    });

    // Notify remaining participants about the updated session
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_updated',
      jamSession,
      username: participantConnection.user.username,
      timestamp: Date.now(),
    });

    console.log(
      `🎵 Host kicked ${participantConnection.user.username} from jam session: ${jamSession.name}`
    );
  }

  private handleJamUpdateQueueFromLocal(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage
  ) {
    const connection = this.clients.get(clientId);
    if (!connection || !message.queue) {
      this.sendError(ws, 'Invalid queue update request');
      return;
    }

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) {
      this.sendError(ws, 'You are not in a jam session');
      return;
    }

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) {
      this.sendError(ws, 'Jam session not found');
      return;
    }

    // Only the host can update the queue from local
    if (!connection.user.isJamSessionHost) {
      this.sendError(ws, 'Only the host can update the queue');
      return;
    }

    // Remove duplicates from the incoming queue
    const uniqueQueue = message.queue.filter((song: any, index: number, arr: any[]) => {
      return !arr.slice(0, index).some(
        (prevSong: any) => 
          prevSong.id === song.id || 
          prevSong.token === song.token ||
          (prevSong.id === song.token && prevSong.token === song.id)
      );
    });

    // Update the jam session queue with the deduplicated local queue
    jamSession.queue = uniqueQueue;
    this.jamSessions.set(sessionId, jamSession);

    console.log(
      `🎵 Host updated jam session queue from local queue: ${jamSession.queue.length} songs`
    );

    // Notify all participants about the updated queue
    this.broadcastToJamSessionParticipants(
      sessionId,
      {
        type: 'jam_queue_updated',
        jamSession,
        queue: jamSession.queue,
        username: connection.user.username,
        timestamp: Date.now(),
      },
      clientId
    ); // Exclude sender to avoid echo
  }

  private broadcastJamSessions() {
    // Get all sessions and filter based on privacy for each client
    this.clients.forEach((connection, clientId) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        const jamSessionsArray = Array.from(this.jamSessions.values()).filter(
          (session) => {
            // Show public sessions to everyone
            if (!session.isPrivate) return true;
            // Show private sessions only to participants
            return session.participants.includes(clientId);
          }
        );

        this.sendMessage(connection.ws, {
          type: 'jam_updated',
          jamSessions: jamSessionsArray,
          timestamp: Date.now(),
        });
      }
    });
  }

  private broadcastToJamSessionParticipants(
    sessionId: string,
    message: WebSocketResponse,
    excludeClientId?: string
  ) {
    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) return;

    for (const participantId of jamSession.participants) {
      if (excludeClientId && participantId === excludeClientId) continue;

      const participant = this.clients.get(participantId);
      if (participant && participant.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(participant.ws, message);
      }
    }
  }

  // Helper methods for jam session cleanup
  private handleJamSessionCleanupForClient(clientId: string) {
    const connection = this.clients.get(clientId);
    if (!connection) return;

    const sessionId = connection.user.joinedJamSessionId;
    if (!sessionId) return;

    const jamSession = this.jamSessions.get(sessionId);
    if (!jamSession) return;

    console.log(`🔌 User disconnected from jam session: ${connection.user.username} (${connection.user.isJamSessionHost ? 'Host' : 'Participant'})`);

    // Initialize disconnected participants tracking if not exists
    if (!jamSession.disconnectedParticipants) {
      jamSession.disconnectedParticipants = {};
    }

    // Track this disconnected user for potential reconnection
    jamSession.disconnectedParticipants[clientId] = {
      username: connection.user.username,
      disconnectedAt: Date.now(),
      wasHost: connection.user.isJamSessionHost || false,
    };

    // Remove from active participants but keep the session alive
    jamSession.participants = jamSession.participants.filter((id) => id !== clientId);
    
    // If this was the host, we need to either transfer host or keep session without active host
    if (connection.user.isJamSessionHost) {
      console.log(`🎵 Host disconnected from session: ${jamSession.name}, session will wait for reconnection`);
      
      // Find another participant to temporarily make host, or keep session hostless
      const remainingParticipants = jamSession.participants.filter(id => {
        const participant = this.clients.get(id);
        return participant && participant.ws.readyState === WebSocket.OPEN;
      });

      if (remainingParticipants.length > 0) {
        // Transfer host to first remaining participant
        const newHostId = remainingParticipants[0];
        const newHostConnection = this.clients.get(newHostId);
        if (newHostConnection) {
          jamSession.hostId = newHostId;
          jamSession.hostUsername = newHostConnection.user.username;
          newHostConnection.user.isJamSessionHost = true;
          
          console.log(`👑 Transferred host to: ${newHostConnection.user.username}`);
          
          // Notify the new host
          this.sendMessage(newHostConnection.ws, {
            type: 'jam_host_transferred',
            jamSession,
            message: 'You are now the host of this session',
            timestamp: Date.now(),
          });
        }
      } else {
        console.log(`⏸️ Session "${jamSession.name}" has no active participants, waiting for reconnection...`);
      }
    }

    // Update the session
    this.jamSessions.set(sessionId, jamSession);

    // Reset user's jam session data
    connection.user.joinedJamSessionId = undefined;
    connection.user.isJamSessionHost = false;

    // Notify remaining participants about the disconnection (but don't end session)
    this.broadcastToJamSessionParticipants(sessionId, {
      type: 'jam_user_disconnected',
      jamSession,
      username: connection.user.username,
      message: `${connection.user.username} disconnected but can reconnect`,
      timestamp: Date.now(),
    });

    // Broadcast updated jam sessions to all users
    this.broadcastJamSessions();
  }

  private cleanupEmptyJamSessions() {
    const sessionsToDelete: string[] = [];
    const initialSessionCount = this.jamSessions.size;

    this.jamSessions.forEach((jamSession, sessionId) => {
      // Check if all participants are still connected (based on actual connection state, not activity)
      const activeParticipants = jamSession.participants.filter((participantId) => {
        const participant = this.clients.get(participantId);
        return participant && (
          participant.ws.readyState === WebSocket.OPEN || 
          participant.ws.readyState === WebSocket.CONNECTING
        );
      });

      if (activeParticipants.length === 0) {
        // No active participants left - safe to clean up
        console.log(`🧹 Cleaning up empty jam session: ${jamSession.name} (no connected participants)`);
        sessionsToDelete.push(sessionId);
      } else if (activeParticipants.length !== jamSession.participants.length) {
        // Some participants have disconnected, update the list but keep the session
        console.log(
          `🔄 Updating participants for jam session: ${jamSession.name} (${activeParticipants.length}/${jamSession.participants.length} active)`
        );
        jamSession.participants = activeParticipants;
        this.jamSessions.set(sessionId, jamSession);

        // Check if host is still connected
        const hostStillConnected = activeParticipants.includes(jamSession.hostId);
        if (!hostStillConnected) {
          // Host is gone, end the session
          console.log(
            `🎵 Host no longer connected, ending jam session: ${jamSession.name}`
          );
          sessionsToDelete.push(sessionId);

          // Notify remaining participants
          for (const participantId of activeParticipants) {
            const participant = this.clients.get(participantId);
            if (participant && participant.ws.readyState === WebSocket.OPEN) {
              // Reset participant's jam session data
              participant.user.joinedJamSessionId = undefined;
              participant.user.isJamSessionHost = false;

              // Notify participant
              this.sendMessage(participant.ws, {
                type: 'jam_left',
                username: jamSession.hostUsername,
                error: 'Host has disconnected from the session',
                timestamp: Date.now(),
              });
            }
          }
        }
      }
      // If activeParticipants.length === jamSession.participants.length, everyone is still connected - do nothing
    });

    // Delete empty sessions
    sessionsToDelete.forEach((sessionId) => {
      this.jamSessions.delete(sessionId);
    });

    // If any sessions were deleted, broadcast updated sessions
    if (sessionsToDelete.length > 0) {
      console.log(
        `🧹 Cleaned up ${sessionsToDelete.length} empty jam sessions (${initialSessionCount} -> ${this.jamSessions.size})`
      );
      this.broadcastJamSessions();
    }
  }

  // Public methods for stats and management
  getStats(): LiveMusicStats {
    return {
      connectedClients: this.clients.size,
      totalActivities: this.activities.length,
      recentActivities: this.getRecentActivities().length,
      activeUsers: this.getConnectedUsers(),
      jamSessions: this.jamSessions.size,
      uptime: Date.now() - this.startTime,
    };
  }

  getRecentActivitiesForAPI(): LiveMusicActivity[] {
    return this.getRecentActivities();
  }

  getConnectedUsersForAPI(): ConnectedUser[] {
    return this.getConnectedUsers();
  }

  getJamSessionsForAPI(): JamSession[] {
    return Array.from(this.jamSessions.values());
  }

  getJamSessionByIdForAPI(sessionId: string): JamSession | undefined {
    return this.jamSessions.get(sessionId);
  }

  // Manual cleanup method for administrative use
  forceCleanupInactiveClients(): number {
    console.log('🔧 Manual cleanup: Forcing cleanup of inactive clients...');
    const beforeCount = this.clients.size;
    this.cleanupInactiveClients();
    const cleanedCount = beforeCount - this.clients.size;
    console.log(`🔧 Manual cleanup completed: ${cleanedCount} clients removed`);
    return cleanedCount;
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
