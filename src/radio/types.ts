export interface RadioStation {
  id: string; // Unified ID format: provider_internalId
  name: string;
  image: string;
  stream_url: string;
  provider: string; // e.g., 'onlineradiobox', 'air', 'tunein'
  country: string;
  genres: string[];
  language: string[];
  status: 'working' | 'broken' | 'untested';
  last_tested_at?: Date;
  metadata?: Record<string, any>;
}

export interface RadioSection {
  heading: string;
  data: RadioStation[];
}
