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

      case 'jam_create':
        this.handleJamSessionCreate(clientId, ws, message);
        break;

      case 'jam_join':
        this.handleJamSessionJoin(clientId, ws, message);
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
      (client) => client.user.username.toLowerCase() === username.toLowerCase()
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

  private cleanupInactiveClients() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    this.clients.forEach((connection, clientId) => {
      if (now - connection.user.lastActivity > timeout) {
        console.log(
          `🧹 Cleaning up inactive client: ${connection.user.username} (${clientId})`
        );
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
        this.clients.delete(clientId);
      }
    });
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
    const jamSession: JamSession = {
      id: sessionId,
      name: message.jamSessionName,
      hostId: clientId,
      hostUsername: connection.user.username,
      createdAt: Date.now(),
      participants: [clientId],
      queue: [],
      playbackState: 'paused',
      progress: 0,
    };

    // Update user as host
    connection.user.isJamSessionHost = true;
    connection.user.joinedJamSessionId = sessionId;

    // Store jam session
    this.jamSessions.set(sessionId, jamSession);

    console.log(
      `🎵 Jam session created: ${message.jamSessionName} by ${connection.user.username}`
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

    // Add user to participants
    jamSession.participants.push(clientId);
    this.jamSessions.set(jamSession.id, jamSession);

    // Update user
    connection.user.joinedJamSessionId = jamSession.id;

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

    // Update the jam session queue with the local queue
    jamSession.queue = message.queue;
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
    const jamSessionsArray = Array.from(this.jamSessions.values());
    this.broadcastToAll({
      type: 'jam_updated',
      jamSessions: jamSessionsArray,
      timestamp: Date.now(),
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
