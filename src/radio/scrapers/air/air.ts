import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import { RadioStation } from '../../types';

puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const COUNTRY = 'India';
const PROVIDER = 'air';
const OUTPUT_DIR = path.join(process.cwd(), 'scraped_data', COUNTRY);
const OUTPUT_FILE = path.join(OUTPUT_DIR, `${PROVIDER}.json`);

/**
 * Main Scraper Function for All India Radio
 */
export async function scrapeAIR() {
  console.log('Scraping All India Radio...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    await page.goto('https://akashvani.gov.in/radio/live.php', { waitUntil: 'domcontentloaded' });

    const channels = await page.evaluate(() => {
      // @ts-ignore
      return typeof channels !== 'undefined' ? channels : {};
    });

    const allStations: RadioStation[] = [];

    for (const [key, station] of Object.entries(channels) as [string, any][]) {
      allStations.push({
        id: `air_${key}`,
        name: station.name,
        image: station.image,
        stream_url: station.live_url,
        provider: PROVIDER,
        country: COUNTRY,
        genres: ['National', 'News', 'Variety'],
        language: [],
        status: 'working', // Official streams are generally reliable
        metadata: {
          page: station.page,
        },
        last_tested_at: new Date(),
      });
    }

    // Save to JSON file
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allStations, null, 2));
    console.log(`Scraping complete. Saved ${allStations.length} stations to ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error scraping AIR:', error);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeAIR().catch(console.error);
}
