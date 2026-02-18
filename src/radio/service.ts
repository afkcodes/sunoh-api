import { query } from '../helpers/db';
import { RadioStation } from './types';

/**
 * Save or update a radio station in the database
 */
export async function saveRadioStation(station: RadioStation) {
  const sql = `
    INSERT INTO radio_stations (
      id, name, image, stream_url, provider, country, genres, language, status, last_tested_at, metadata, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      image = EXCLUDED.image,
      stream_url = EXCLUDED.stream_url,
      provider = EXCLUDED.provider,
      country = EXCLUDED.country,
      genres = EXCLUDED.genres,
      language = EXCLUDED.language,
      status = EXCLUDED.status,
      last_tested_at = EXCLUDED.last_tested_at,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `;

  const params = [
    station.id,
    station.name,
    station.image,
    station.stream_url,
    station.provider,
    station.country,
    station.genres,
    station.language,
    station.status,
    station.last_tested_at,
    station.metadata ? JSON.stringify(station.metadata) : null,
  ];

  return query(sql, params);
}

/**
 * Search radio stations in the database
 */
export async function searchStations(options: {
  query?: string;
  genre?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}) {
  let sql = 'SELECT * FROM radio_stations WHERE 1=1';
  const params: any[] = [];

  if (options.query) {
    params.push(`%${options.query}%`);
    sql += ` AND (name ILIKE $${params.length} OR array_to_string(genres, ',') ILIKE $${params.length})`;
  }

  if (options.genre) {
    params.push(options.genre);
    sql += ` AND $${params.length} = ANY(genres)`;
  }

  if (options.provider) {
    params.push(options.provider);
    sql += ` AND provider = $${params.length}`;
  }

  sql += " ORDER BY CASE WHEN status = 'working' THEN 0 ELSE 1 END, name ASC";

  if (options.limit) {
    params.push(options.limit);
    sql += ` LIMIT $${params.length}`;
  }

  if (options.offset) {
    params.push(options.offset);
    sql += ` OFFSET $${params.length}`;
  }

  const { rows } = await query(sql, params);
  return rows.map(mapDbToStation);
}

/**
 * Get stations by provider
 */
export async function getStationsByProvider(provider: string, limit = 50) {
  const { rows } = await query(
    'SELECT * FROM radio_stations WHERE provider = $1 ORDER BY name ASC LIMIT $2',
    [provider, limit],
  );
  return rows.map(mapDbToStation);
}

/**
 * Helper to map DB row to RadioStation interface
 */
function mapDbToStation(row: any): RadioStation {
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    stream_url: row.stream_url,
    provider: row.provider,
    country: row.country,
    genres: row.genres || [],
    language: row.language || [],
    status: row.status as any,
    last_tested_at: row.last_tested_at,
    metadata: row.metadata,
  };
}
