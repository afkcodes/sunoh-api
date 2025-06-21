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
  isJamSessionHost?: boolean;
  joinedJamSessionId?: string;
}

export interface JamSession {
  id: string;
  name: string;
  hostId: string;
  hostUsername: string;
  createdAt: number;
  participants: string[]; // Array of user ids who joined this session
  queue: LiveMusicActivity['song'][]; // Current queue of songs
  currentSong?: LiveMusicActivity['song']; // Currently playing song
  playbackState?: 'playing' | 'paused'; // Current playback state
  progress?: number; // Current playback progress in seconds
  isPrivate?: boolean; // Whether the session is private
  inviteCode?: string; // Invite code for private sessions
  syncPlayMode?: boolean; // Whether synchronized playback is enabled
  lastProgressUpdate?: number; // Timestamp of last progress update for sync
  lastEmptyTime?: number; // Timestamp when session became empty (no connected participants)
  disconnectedParticipants?: { // Track disconnected participants for reconnection
    [userId: string]: {
      username: string;
      disconnectedAt: number;
      wasHost: boolean;
    };
  };
}

export interface WebSocketMessage {
  type:
    | 'connect'
    | 'activity'
    | 'ping'
    | 'disconnect'
    | 'heartbeat'
    | 'jam_create'
    | 'jam_join'
    | 'jam_join_with_code'
    | 'jam_leave'
    | 'jam_add_to_queue'
    | 'jam_update_state'
    | 'jam_sync_request'
    | 'jam_next_track'
    | 'jam_remove_from_queue'
    | 'jam_reorder_queue'
    | 'jam_kick_participant'
    | 'jam_update_queue_from_local'
    | 'jam_toggle_sync_play'
    | 'jam_sync_play_progress';
  username?: string;
  activity?: Omit<LiveMusicActivity, 'id' | 'username' | 'timestamp'>;
  timestamp?: number;
  jamSessionId?: string;
  jamSessionName?: string;
  song?: LiveMusicActivity['song'];
  playbackState?: 'playing' | 'paused';
  progress?: number;
  queue?: LiveMusicActivity['song'][];
  songIndex?: number;
  fromIndex?: number;
  toIndex?: number;
  participantId?: string;
  initialSong?: LiveMusicActivity['song'];
  initialTrack?: any; // MediaTrack object from frontend
  isPrivate?: boolean;
  inviteCode?: string;
  syncPlayEnabled?: boolean; // For sync play toggle
  isPlaying?: boolean; // For sync play progress
}

export interface WebSocketResponse {
  type:
    | 'connected'
    | 'activity'
    | 'pong'
    | 'error'
    | 'user_joined'
    | 'user_left'
    | 'heartbeat'
    | 'jam_created'
    | 'jam_updated'
    | 'jam_joined'
    | 'jam_left'
    | 'jam_queue_updated'
    | 'jam_state_updated'
    | 'jam_sync_response'
    | 'jam_track_ended'
    | 'jam_participant_kicked'
    | 'jam_host_transferred'
    | 'jam_user_disconnected'
    | 'jam_reconnection_available'
    | 'jam_sync_play_toggled'
    | 'jam_sync_play_progress';
  clientId?: string;
  username?: string;
  activity?: LiveMusicActivity;
  recentActivities?: LiveMusicActivity[];
  error?: string;
  message?: string;
  action?: string; // For distinguishing queue update types (add, reorder, remove)
  timestamp?: number;
  connectedUsers?: ConnectedUser[];
  jamSession?: JamSession;
  jamSessions?: JamSession[];
  song?: LiveMusicActivity['song'];
  playbackState?: 'playing' | 'paused';
  progress?: number;
  queue?: LiveMusicActivity['song'][];
  enabled?: boolean; // For sync play toggle response
  isPlaying?: boolean; // For sync play progress response
}

export interface LiveMusicStats {
  connectedClients: number;
  totalActivities: number;
  recentActivities: number;
  activeUsers: ConnectedUser[];
  jamSessions: number;
  uptime: number;
}
