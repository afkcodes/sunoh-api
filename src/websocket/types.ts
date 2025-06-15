// Types for live music WebSocket functionality

export interface LiveMusicActivity {
  id: string;
  username: string;
  song: {
    id: string;
    title: string;
    artist: string;
    artwork?: { src: string }[];
    duration?: number;
    token?: string;
    rawData?: any;
  };
  timestamp: number;
  action: 'play' | 'pause' | 'skip' | 'seek';
}

export interface ConnectedUser {
  id: string;
  username: string;
  lastActivity: number;
  connectedAt: number;
}

export interface WebSocketMessage {
  type: 'connect' | 'activity' | 'ping' | 'disconnect' | 'heartbeat';
  username?: string;
  activity?: Omit<LiveMusicActivity, 'id' | 'username' | 'timestamp'>;
  timestamp?: number;
}

export interface WebSocketResponse {
  type: 'connected' | 'activity' | 'pong' | 'error' | 'user_joined' | 'user_left' | 'heartbeat';
  clientId?: string;
  username?: string;
  activity?: LiveMusicActivity;
  recentActivities?: LiveMusicActivity[];
  error?: string;
  timestamp?: number;
  connectedUsers?: ConnectedUser[];
}

export interface LiveMusicStats {
  connectedClients: number;
  totalActivities: number;
  recentActivities: number;
  activeUsers: ConnectedUser[];
  uptime: number;
}
