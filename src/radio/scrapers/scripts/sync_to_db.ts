import fs from 'fs';
import path from 'path';
import { query } from '../../../helpers/db';

/**
 * Syncs a validated provider JSON file to the PostgreSQL database.
 * Handles merging of providers, countries, and genres.
 */
async function syncProviderToDb(providerName: string) {
  const filePath = path.join(
    process.cwd(),
    'src/radio/scrapers/metadata',
    `validated_${providerName}.json`,
  );

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  console.log(`\n>>> Starting Database Sync for ${providerName.toUpperCase()}...`);

  const stations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  let inserted = 0;
  let updated = 0;

  for (const station of stations) {
    try {
      // Upsert Query Logic
      // 1. If URL exists, merge providers, countries, genres, and update status
      // 2. If it is verified, dont let the status be downgraded by the scrape
      const upsertQuery = `
        INSERT INTO radio_stations (
          name, image_url, stream_url, providers, countries, genres, languages, 
          status, codec, bitrate, sample_rate, last_tested_at
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (stream_url) DO UPDATE SET
          -- Merge Providers JSONB
          providers = radio_stations.providers || EXCLUDED.providers,
          
          -- Merge Countries Array
          countries = ARRAY(
            SELECT DISTINCT e FROM UNNEST(radio_stations.countries || EXCLUDED.countries) AS e
          ),
          
          -- Merge Genres Array
          genres = ARRAY(
            SELECT DISTINCT e FROM UNNEST(radio_stations.genres || EXCLUDED.genres) AS e
          ),

          -- Only update name/image if new one is longer/better (optional logic)
          name = CASE WHEN LENGTH(EXCLUDED.name) > LENGTH(radio_stations.name) THEN EXCLUDED.name ELSE radio_stations.name END,
          image_url = CASE WHEN EXCLUDED.image_url LIKE 'https%' AND radio_stations.image_url NOT LIKE 'https%' THEN EXCLUDED.image_url ELSE radio_stations.image_url END,
          
          -- Resilience logic: Reset failure count on success
          failure_count = CASE WHEN EXCLUDED.status = 'working' THEN 0 ELSE radio_stations.failure_count + 1 END,
          
          -- Only update status/codec if not verified by a human
          status = CASE WHEN radio_stations.is_verified = TRUE THEN radio_stations.status ELSE EXCLUDED.status END,
          codec = CASE WHEN radio_stations.is_verified = TRUE THEN radio_stations.codec ELSE COALESCE(EXCLUDED.codec, radio_stations.codec) END,
          
          last_tested_at = EXCLUDED.last_tested_at,
          updated_at = CURRENT_TIMESTAMP
        RETURNING (xmin = 0) as is_new;
      `;

      const providersJson = JSON.stringify({ [providerName]: station.provider_id });

      const values = [
        station.name,
        station.image_url,
        station.stream_url,
        providersJson,
        station.countries,
        station.genres,
        station.languages,
        station.status,
        station.codec !== 'unknown' ? station.codec : null,
        station.bitrate,
        station.sample_rate,
        station.last_tested_at,
      ];

      const res = await query(upsertQuery, values);

      if (res.rows[0]?.is_new) {
        inserted++;
      } else {
        updated++;
      }

      if ((inserted + updated) % 500 === 0) {
        console.log(`Progress: ${inserted + updated}/${stations.length} processed...`);
      }
    } catch (err) {
      console.error(`Error syncing station ${station.name}:`, err);
    }
  }

  console.log('\n' + '='.repeat(50));
  printSummary(providerName, stations.length, inserted, updated);
  console.log('='.repeat(50));
}

function printSummary(provider: string, total: number, inserted: number, updated: number) {
  console.log(`          SYNC COMPLETE: ${provider.toUpperCase()}`);
  console.log('-'.repeat(50));
  console.log(`Total stations in file: ${total}`);
  console.log(`New stations added:     ${inserted}`);
  console.log(`Existing stations merged: ${updated}`);
}

// CLI Support
if (require.main === module) {
  const provider = process.argv[2];
  if (!provider) {
    console.error('Usage: npx tsx sync_to_db.ts [provider_name]');
    process.exit(1);
  }

  syncProviderToDb(provider)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
