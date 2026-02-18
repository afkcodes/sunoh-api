import { query } from './db';

const createTableQuery = `
CREATE TABLE IF NOT EXISTS radio_stations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  image TEXT,
  stream_url TEXT NOT NULL,
  provider VARCHAR(50),
  country VARCHAR(100),
  genres TEXT[],
  language TEXT[],
  status VARCHAR(20) DEFAULT 'untested',
  last_tested_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_radio_provider ON radio_stations(provider);
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
