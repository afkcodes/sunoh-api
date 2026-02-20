export interface RadioStation {
  id: string; // Unified ID format: provider_internalId (e.g. 'onlineradiobox_123')
  name: string;
  image: string; // Full URL to station logo
  stream_url: string; // The final validated playable audio URL
  website: string; // Official station website (original source)
  provider: string; // Scraper source identifier (e.g. 'onlineradiobox', 'mytuner', 'youradio')
  country: string; // Normalised country name
  genres: string[]; // Array of genre strings
  languages: string[]; // Array of language strings (plural)
  description: string; // Short description or bio of the station
  status: 'working' | 'broken' | 'untested';
  codec: string; // Audio format (mp3, aac, hls, etc.)
  bitrate?: string; // Optional: bitrate in bps
  sample_rate?: string; // Optional: sample rate in Hz
  last_tested_at: string; // ISO 8601 UTC timestamp
  metadata?: any; // Optional: Provider-specific auxiliary data
}

export interface RadioSection {
  heading: string;
  data: RadioStation[];
}
