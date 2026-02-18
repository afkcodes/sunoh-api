import { query } from './db';

const createTableQuery = `
CREATE TABLE IF NOT EXISTS radio_stations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  image_url TEXT,                      -- Source image
  image_hosted TEXT,                   -- Hosted image (ImageKit)
  stream_url TEXT UNIQUE NOT NULL,    -- UNIQUE key for deduplication
  providers JSONB DEFAULT '{}',       -- { "orb": "id1", "mytuner": "id2" }
  countries TEXT[] DEFAULT '{}',      -- [ "US", "GB" ]
  genres TEXT[] DEFAULT '{}',
  languages TEXT[] DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'untested',
  codec VARCHAR(50),
  bitrate INTEGER,
  sample_rate INTEGER,
  failure_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,  -- Protective flag for major stations
  last_tested_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_radio_stream_url ON radio_stations(stream_url);
CREATE INDEX IF NOT EXISTS idx_radio_status ON radio_stations(status);
`;

export async function initDatabase() {
  try {
    console.log('Initializing database...');
    await query(createTableQuery);
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  initDatabase().then(() => process.exit(0));
}
