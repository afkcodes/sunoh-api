import puppeteer from 'puppeteer-extra';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const url = process.argv[2];
if (!url) {
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  );

  try {
    // Using domcontentloaded is much more reliable than networkidle2 for sites with heavy ads
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait for at least one station to appear
    await page.waitForSelector('li.stations__station, .tablelist .item', { timeout: 10000 }).catch(() => {});

    const stations = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll(
        'li.stations__station, .tablelist .item, .stations-list li',
      );

      items.forEach((item) => {
        const btn = item.querySelector('.station_play');
        if (!btn) return;

        const internalId = btn.getAttribute('radioid') || '';
        const name = btn.getAttribute('radioname') || '';
        const image = btn.getAttribute('radioimg') || '';
        const stream = btn.getAttribute('stream') || '';

        // Genres
        const genreLinks = item.querySelectorAll(
          '.stations__station__tags a, .station_categories a, a[href*="/genre/"]',
        );
        const genres = Array.from(
          new Set(
            Array.from(genreLinks)
              .map((a) => a.textContent?.trim() || '')
              .filter(Boolean),
          ),
        );

        if (internalId && stream) {
          results.push({ internalId, name, image, stream, genres });
        }
      });
      return results;
    });

    const paginationInfo = await page.evaluate(() => {
      const paginator = document.querySelector('.pagination');
      if (!paginator) return { hasMore: false, activePage: 1, nextUrl: null };

      const nextLink = Array.from(paginator.querySelectorAll('a')).find(
        (a) => a.textContent.toLowerCase().includes('next') || a.classList.contains('next'),
      );

      const activeSpan =
        paginator.querySelector('.active') || paginator.querySelector('span:not(a)');
      const activePage = activeSpan ? parseInt(activeSpan.textContent) : 1;

      return {
        hasMore: !!nextLink,
        activePage: activePage,
        nextUrl: nextLink ? nextLink.href : null,
      };
    });

    const currentUrl = page.url();

    for (const s of stations) {
      console.log(
        JSON.stringify({
          ...s,
          _hasMore: paginationInfo.hasMore,
          _activePage: paginationInfo.activePage,
          _nextUrl: paginationInfo.nextUrl,
          _currentUrl: currentUrl,
        }),
      );
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
