import puppeteer from 'puppeteer';

function extractPlaylistId(url: string): string | null {
  if (!url) return null;
  // Match Spotify playlist URLs
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function scrapePlaylist(url: string, opts: any = {}) {
  const { headless = true, debug = false, timeout = 30000, fast = false } = opts;

  if (debug) console.error('[debug] Launching browser...');

  const browser = await puppeteer.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-extensions-file-access-check',
      '--disable-extensions-https-enforcement',
    ],
  });

  try {
    const page = await browser.newPage();

    // Set a realistic user agent and optimized viewport for good balance of tracks visibility and performance
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 1366, height: 3000 }); // Optimized height - good balance between performance and track visibility

    // Remove automation indicators
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock languages and plugins
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Mock chrome object
      (window as any).chrome = {
        runtime: {},
      };

      // Remove webdriver property
      delete (navigator as any).__proto__.webdriver;
    });

    if (debug) console.error(`[debug] Navigating to ${url}...`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout,
    });

    // Wait for playlist content to load - try multiple selectors
    if (debug) console.error('[debug] Waiting for playlist content...');

    try {
      // Try different possible selectors for playlist pages
      await Promise.race([
        page.waitForSelector('[data-testid="playlist-page"]', { timeout: 8000 }),
        page.waitForSelector('[data-testid="entityTitle"]', { timeout: 8000 }),
        page.waitForSelector('h1[data-testid="entityTitle"]', { timeout: 8000 }),
        page.waitForSelector('.main-view-container', { timeout: 8000 }),
      ]);
    } catch (error) {
      if (debug) console.error('[debug] Primary selectors failed, trying alternative approach...');

      // Wait a bit longer for any content
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check if we have any playlist-like content
      const hasContent = await page.evaluate(() => {
        return (
          document.querySelector('h1') !== null ||
          document.querySelector('[role="main"]') !== null ||
          document.querySelector('.main-view-container') !== null
        );
      });

      if (!hasContent) {
        throw new Error(
          'Playlist content not found. Spotify may have blocked access or changed their layout.',
        );
      }
    }

    if (debug) console.error('[debug] Page loaded, extracting playlist info...');

    // Extract playlist metadata
    const playlistInfo = await page.evaluate(() => {
      // Try multiple selectors for playlist name
      let nameEl = document.querySelector('h1[data-testid="entityTitle"]');

      // If not found, try the topbar-content-wrapper
      if (!nameEl || !nameEl.textContent.trim()) {
        nameEl = document.querySelector('.topbar-content-wrapper h1');
      }

      // Additional fallbacks
      if (!nameEl || !nameEl.textContent.trim()) {
        nameEl =
          document.querySelector('[data-testid="playlist-page"] h1') ||
          document.querySelector('main h1') ||
          document.querySelector('h1');
      }

      const descEl = document.querySelector('[data-testid="description"]');

      return {
        name: nameEl ? nameEl.textContent.trim() : 'Unknown Playlist',
        description: descEl ? descEl.textContent.trim() : '',
      };
    });

    if (debug) console.error(`[debug] Found playlist: ${playlistInfo.name}`);

    // Scroll to load all tracks (Spotify lazy loads) - scrape as we go
    if (debug) console.error('[debug] Scrolling and scraping tracks as they become visible...');

    // First, let's debug what containers are available
    if (debug) {
      const containers = await page.evaluate(() => {
        const selectors = [
          '[data-testid="playlist-tracklist"]',
          '[data-testid="tracklist"]',
          '.main-view-container .os-viewport',
          '.main-view-container [data-overlayscrollbars-viewport]',
          '.tracklist-container',
          '[role="grid"]',
          '.main-view-container',
          '[role="main"]',
          '.Root__main-view',
        ];

        return selectors.map((sel) => ({
          selector: sel,
          exists: document.querySelector(sel) !== null,
          hasScrollHeight:
            document.querySelector(sel)?.scrollHeight > document.querySelector(sel)?.clientHeight,
        }));
      });

      console.error(
        '[debug] Available containers:',
        containers.filter((c) => c.exists),
      );
    }

    // First scroll to top to ensure we start from the beginning
    await page.evaluate(() => {
      const viewport = document.querySelector(
        '.main-view-container [data-overlayscrollbars-viewport]',
      );
      if (viewport) {
        viewport.scrollTop = 0;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Track all unique tracks we've seen
    const allTracks = new Map(); // Use Map to avoid duplicates based on track ID
    let scrollAttempts = 0;
    let lastScrollHeight = 0;
    let stableScrollCount = 0;
    let lastTrackCount = 0;
    let noNewTracksCount = 0;

    while (scrollAttempts < 100) {
      scrollAttempts++;

      // Extract currently visible tracks with optimized DOM queries
      const currentTracks = await page.evaluate(() => {
        const trackRows = document.querySelectorAll('[data-testid="tracklist-row"]');
        const results = [];

        // Pre-compile regex for better performance
        const timeRegex = /^\d+:\d{2}$/;

        trackRows.forEach((row, index) => {
          try {
            // Track name
            const nameEl = row.querySelector('[data-testid="internal-track-link"]');
            const name = nameEl?.textContent?.trim();
            if (!name) return; // Skip if no track name

            // Artists - optimized query
            const artistEls = row.querySelectorAll('a[href*="/artist/"]');
            const artists = Array.from(artistEls, (el) => el.textContent.trim()).filter(Boolean);
            if (artists.length === 0) return; // Skip if no artists

            // Album
            const albumEl = row.querySelector('a[href*="/album/"]');
            const album = albumEl?.textContent?.trim() || '';

            // Duration - optimized lookup
            let durationEl = row.querySelector('[data-testid="duration"]');
            let durationText = '';

            if (durationEl) {
              durationText = durationEl.textContent.trim();
            } else {
              // Fallback: find duration pattern more efficiently
              const textNodes = row.querySelectorAll('*');
              for (let i = 0; i < textNodes.length; i++) {
                const element = textNodes[i];
                const text = element.textContent?.trim();
                if (text && timeRegex.test(text) && !element.querySelector('*')) {
                  durationText = text;
                  break;
                }
              }
            }

            // Convert duration to milliseconds
            let durationMs = 0;
            if (durationText && timeRegex.test(durationText)) {
              const [minutes, seconds] = durationText.split(':').map(Number);
              durationMs = (minutes * 60 + seconds) * 1000;
            }

            // Track URL/ID
            const trackLink = nameEl ? nameEl.getAttribute('href') : '';
            const trackId = trackLink ? trackLink.split('/track/')[1]?.split('?')[0] : '';

            results.push({
              name,
              artists,
              album,
              durationMs,
              duration: durationText,
              id: trackId || `track_${name}_${artists[0]}_${index}`,
              url: trackLink ? `https://open.spotify.com${trackLink}` : '',
              scrollPosition: index,
            });
          } catch (error) {
            // Silently ignore extraction errors to avoid console spam
          }
        });

        return results;
      });

      // Add new tracks to our collection
      let newTracksFound = 0;
      currentTracks.forEach((track) => {
        if (!allTracks.has(track.id)) {
          allTracks.set(track.id, track);
          newTracksFound++;
        }
      });

      if (debug) {
        console.error(
          `[debug] Scroll ${scrollAttempts}: Found ${currentTracks.length} visible tracks, ${newTracksFound} new, total unique: ${allTracks.size}`,
        );
      }

      // Early termination if no new tracks for several attempts - be more conservative
      if (newTracksFound === 0) {
        noNewTracksCount++;
      } else {
        noNewTracksCount = 0;
      }

      // If we haven't found new tracks in 5 consecutive attempts (or 4 in fast mode), try to finish quickly
      const maxNoNewTracks = fast ? 4 : 5; // Increased from 3/2 to be more conservative
      if (noNewTracksCount >= maxNoNewTracks) {
        if (debug)
          console.error('[debug] No new tracks found in 5 attempts, accelerating completion...');

        // Quick final scroll to bottom to ensure we didn't miss anything
        await page.evaluate(() => {
          const viewport = document.querySelector(
            '.main-view-container [data-overlayscrollbars-viewport]',
          );
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          }
        });

        // Shorter wait for final check - but not too short
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased from 1000ms

        // One final track extraction with full metadata
        const finalTracks = await page.evaluate(() => {
          const trackRows = document.querySelectorAll('[data-testid="tracklist-row"]');
          const results = [];
          const timeRegex = /^\d+:\d{2}$/;

          trackRows.forEach((row, index) => {
            try {
              const nameEl = row.querySelector('[data-testid="internal-track-link"]');
              const name = nameEl?.textContent?.trim();
              if (!name) return;

              const artistEls = row.querySelectorAll('a[href*="/artist/"]');
              const artists = Array.from(artistEls, (el) => el.textContent.trim()).filter(Boolean);
              if (artists.length === 0) return;

              const albumEl = row.querySelector('a[href*="/album/"]');
              const album = albumEl?.textContent?.trim() || '';

              let durationEl = row.querySelector('[data-testid="duration"]');
              let durationText = '';

              if (durationEl) {
                durationText = durationEl.textContent.trim();
              } else {
                const textNodes = row.querySelectorAll('*');
                for (let i = 0; i < textNodes.length; i++) {
                  const element = textNodes[i];
                  const text = element.textContent?.trim();
                  if (text && timeRegex.test(text) && !element.querySelector('*')) {
                    durationText = text;
                    break;
                  }
                }
              }

              let durationMs = 0;
              if (durationText && timeRegex.test(durationText)) {
                const [minutes, seconds] = durationText.split(':').map(Number);
                durationMs = (minutes * 60 + seconds) * 1000;
              }

              const trackLink = nameEl ? nameEl.getAttribute('href') : '';
              const trackId = trackLink ? trackLink.split('/track/')[1]?.split('?')[0] : '';

              if (trackId) {
                results.push({
                  name,
                  artists,
                  album,
                  durationMs,
                  duration: durationText,
                  id: trackId,
                  url: trackLink ? `https://open.spotify.com${trackLink}` : '',
                  scrollPosition: allTracks.size + index,
                });
              }
            } catch (error) {
              // Ignore extraction errors in final pass
            }
          });

          return results;
        });

        let finalNewTracks = 0;
        finalTracks.forEach((track) => {
          if (!allTracks.has(track.id)) {
            allTracks.set(track.id, track);
            finalNewTracks++;
          }
        });

        if (debug)
          console.error(`[debug] Final quick check: ${finalNewTracks} additional tracks found`);
        break; // Exit early
      }

      // Scroll down incrementally with variable scroll amounts
      const scrollResult = await page.evaluate((attempt) => {
        const viewport = document.querySelector(
          '.main-view-container [data-overlayscrollbars-viewport]',
        );

        if (viewport) {
          const oldScrollTop = viewport.scrollTop;
          const oldScrollHeight = viewport.scrollHeight;

          // Use smaller scroll increments for better coverage
          let scrollAmount = 400;

          // As we get further, reduce scroll amount to catch more tracks
          if (attempt > 20) scrollAmount = 300;
          if (attempt > 40) scrollAmount = 200;
          if (attempt > 60) scrollAmount = 150;

          viewport.scrollBy(0, scrollAmount);

          return {
            oldScrollTop,
            newScrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight,
            clientHeight: viewport.clientHeight,
            atBottom: viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 5,
            scrollAmount,
          };
        }

        return { atBottom: true };
      }, scrollAttempts);

      // Adaptive wait time - be more generous to ensure we don't miss tracks
      const baseWaitTime = fast ? 1000 : 1500; // Increased base wait times
      const waitTime =
        noNewTracksCount >= 2
          ? baseWaitTime
          : noNewTracksCount >= 1
            ? baseWaitTime + 500
            : fast
              ? 1500 // Increased from 1200
              : 2500; // Increased from 2000
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Check if we've reached the bottom and no new tracks for several attempts
      if (scrollResult.atBottom || scrollResult.scrollHeight === lastScrollHeight) {
        stableScrollCount++;
        if (debug) console.error(`[debug] Stable scroll count: ${stableScrollCount}/8`);

        if (stableScrollCount >= 8) {
          // Increased back to 8 for better accuracy with 100-track playlists
          if (debug) console.error('[debug] Reached bottom consistently, doing one final check...');

          // One quick final scroll to absolute bottom
          await page.evaluate(() => {
            const viewport = document.querySelector(
              '.main-view-container [data-overlayscrollbars-viewport]',
            );
            if (viewport) {
              viewport.scrollTop = viewport.scrollHeight;
            }
          });

          await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased wait time for final check

          // Extract any remaining tracks with full metadata
          const finalCheck = await page.evaluate(() => {
            const trackRows = document.querySelectorAll('[data-testid="tracklist-row"]');
            const results = [];
            const timeRegex = /^\d+:\d{2}$/;

            trackRows.forEach((row, index) => {
              try {
                // Track name
                const nameEl = row.querySelector('[data-testid="internal-track-link"]');
                const name = nameEl?.textContent?.trim();
                if (!name) return;

                // Artists
                const artistEls = row.querySelectorAll('a[href*="/artist/"]');
                const artists = Array.from(artistEls, (el) => el.textContent.trim()).filter(
                  Boolean,
                );
                if (artists.length === 0) return;

                // Album
                const albumEl = row.querySelector('a[href*="/album/"]');
                const album = albumEl?.textContent?.trim() || '';

                // Duration
                let durationEl = row.querySelector('[data-testid="duration"]');
                let durationText = '';

                if (durationEl) {
                  durationText = durationEl.textContent.trim();
                } else {
                  const textNodes = row.querySelectorAll('*');
                  for (let i = 0; i < textNodes.length; i++) {
                    const element = textNodes[i];
                    const text = element.textContent?.trim();
                    if (text && timeRegex.test(text) && !element.querySelector('*')) {
                      durationText = text;
                      break;
                    }
                  }
                }

                // Convert duration to milliseconds
                let durationMs = 0;
                if (durationText && timeRegex.test(durationText)) {
                  const [minutes, seconds] = durationText.split(':').map(Number);
                  durationMs = (minutes * 60 + seconds) * 1000;
                }

                // Track URL/ID
                const trackLink = nameEl ? nameEl.getAttribute('href') : '';
                const trackId = trackLink ? trackLink.split('/track/')[1]?.split('?')[0] : '';

                if (trackId) {
                  results.push({
                    name,
                    artists,
                    album,
                    durationMs,
                    duration: durationText,
                    id: trackId,
                    url: trackLink ? `https://open.spotify.com${trackLink}` : '',
                    scrollPosition: allTracks.size + index,
                  });
                }
              } catch (error) {
                // Silently ignore extraction errors
              }
            });

            return results;
          });

          let finalNewTracks = 0;
          finalCheck.forEach((track) => {
            if (!allTracks.has(track.id)) {
              allTracks.set(track.id, track);
              finalNewTracks++;
            }
          });

          if (debug && finalNewTracks > 0) {
            console.error(`[debug] Final check: Found ${finalNewTracks} additional tracks`);
          }

          break;
        }
      } else {
        stableScrollCount = 0;
      }

      lastScrollHeight = scrollResult.scrollHeight || lastScrollHeight;

      // Safety break for very large playlists
      if (allTracks.size > 1000) {
        if (debug) console.error('[debug] Reached 1000+ tracks, stopping...');
        break;
      }
    }

    // Convert Map to array and sort by the order we found them
    const tracks = Array.from(allTracks.values()).sort((a, b) => {
      // If we have scroll positions, use them, otherwise use the order we added them
      return (a.scrollPosition || 0) - (b.scrollPosition || 0);
    });

    if (debug) console.error(`[debug] Final collection: ${tracks.length} unique tracks`);

    const playlistId = extractPlaylistId(url);

    if (debug) console.error(`[debug] Extracted ${tracks.length} tracks`);

    return {
      playlistId: playlistId || 'unknown',
      playlistName: playlistInfo.name,
      description: playlistInfo.description,
      trackCount: tracks.length,
      tracks,
    };
  } finally {
    await browser.close();
  }
}

export { extractPlaylistId, scrapePlaylist };
