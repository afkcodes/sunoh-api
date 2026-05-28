// One-off smoke test for the cleaned Spotify importer.
//
// Usage:
//   npx tsx scripts/smoke-spotify-import.ts <playlistIdOrUrl>
//
// Times the scrape, prints summary stats, and dumps a sample. Doesn't
// touch the Saavn matcher (which would also require Redis + network);
// keeps this lean to verify just the Puppeteer side.

import { extractPlaylistId, fetchSpotifyPlaylist } from '../src/spotify/scraper';

const input = process.argv[2];
if (!input) {
  console.error('Usage: tsx scripts/smoke-spotify-import.ts <playlistIdOrUrl>');
  process.exit(2);
}
const id = extractPlaylistId(input);
if (!id) {
  console.error(`Could not extract playlist id from input: ${input}`);
  process.exit(2);
}

(async () => {
  console.error(`[smoke] scraping playlist ${id} …`);
  const t0 = Date.now();
  const pl = await fetchSpotifyPlaylist(id, { debug: true });
  const dtMs = Date.now() - t0;
  if (!pl) {
    console.error(`[smoke] FAILED in ${dtMs} ms`);
    process.exit(1);
  }
  console.error(`[smoke] OK in ${(dtMs / 1000).toFixed(1)} s — ${pl.tracks.length} tracks scraped`);
  console.error(`  name:  ${pl.name}`);
  console.error(`  owner: ${pl.owner ?? '(unknown)'}`);
  console.error(`  art:   ${pl.artworkUrl ?? '(none)'}`);
  console.error('  sample:');
  for (const t of pl.tracks.slice(0, 3)) {
    console.error(`    - ${t.name} — ${t.artists.join(', ')} [${t.album}] ${t.durationMs}ms`);
  }
  if (pl.tracks.length > 3) {
    console.error(`    … (${pl.tracks.length - 6} more)`);
    for (const t of pl.tracks.slice(-3)) {
      console.error(`    - ${t.name} — ${t.artists.join(', ')} [${t.album}] ${t.durationMs}ms`);
    }
  }
  process.exit(0);
})();
