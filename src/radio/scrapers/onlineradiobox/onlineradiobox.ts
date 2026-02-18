import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import puppeteer, { Page } from 'puppeteer';
import { RadioStation } from '../../types';

const PROVIDER = 'onlineradiobox';

const ORB_COUNTRIES = [
  { code: 'ad', name: 'Andorra' },
  { code: 'ae', name: 'UAE' },
  { code: 'af', name: 'Afghanistan' },
  { code: 'ag', name: 'Antigua and Barbuda' },
  { code: 'ai', name: 'Anguilla' },
  { code: 'al', name: 'Albania' },
  { code: 'am', name: 'Armenia' },
  { code: 'ao', name: 'Angola' },
  { code: 'ar', name: 'Argentina' },
  { code: 'as', name: 'American Samoa' },
  { code: 'at', name: 'Austria' },
  { code: 'au', name: 'Australia' },
  { code: 'aw', name: 'Aruba' },
  { code: 'az', name: 'Azerbaijan' },
  { code: 'ba', name: 'Bosnia and Herzegovina' },
  { code: 'bb', name: 'Barbados' },
  { code: 'bd', name: 'Bangladesh' },
  { code: 'be', name: 'Belgium' },
  { code: 'bf', name: 'Burkina Faso' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'bh', name: 'Bahrain' },
  { code: 'bi', name: 'Burundi' },
  { code: 'bj', name: 'Benin' },
  { code: 'bl', name: 'Saint-Barthelemy' },
  { code: 'bm', name: 'Bermuda' },
  { code: 'bn', name: 'Brunei' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'bq', name: 'Bonaire' },
  { code: 'br', name: 'Brazil' },
  { code: 'bs', name: 'Bahamas' },
  { code: 'bt', name: 'Bhutan' },
  { code: 'bw', name: 'Botswana' },
  { code: 'bz', name: 'Belize' },
  { code: 'ca', name: 'Canada' },
  { code: 'cd', name: 'DR Congo' },
  { code: 'cf', name: 'CAR' },
  { code: 'cg', name: 'Congo' },
  { code: 'ch', name: 'Switzerland' },
  { code: 'ci', name: 'Ivory Coast' },
  { code: 'ck', name: 'Cook Islands' },
  { code: 'cl', name: 'Chile' },
  { code: 'cm', name: 'Cameroon' },
  { code: 'cn', name: 'China' },
  { code: 'co', name: 'Colombia' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'cu', name: 'Cuba' },
  { code: 'cv', name: 'Cape Verde' },
  { code: 'cw', name: 'Curacao' },
  { code: 'cy', name: 'Cyprus' },
  { code: 'cz', name: 'Czech Republic' },
  { code: 'de', name: 'Germany' },
  { code: 'dj', name: 'Djibouti' },
  { code: 'dk', name: 'Denmark' },
  { code: 'dm', name: 'Dominica' },
  { code: 'do', name: 'Dominican Republic' },
  { code: 'dz', name: 'Algeria' },
  { code: 'ec', name: 'Ecuador' },
  { code: 'ee', name: 'Estonia' },
  { code: 'eg', name: 'Egypt' },
  { code: 'eh', name: 'Western Sahara' },
  { code: 'er', name: 'Eritrea' },
  { code: 'es', name: 'Spain' },
  { code: 'et', name: 'Ethiopia' },
  { code: 'fi', name: 'Finland' },
  { code: 'fj', name: 'Fiji' },
  { code: 'fk', name: 'Falkland Islands' },
  { code: 'fm', name: 'Micronesia' },
  { code: 'fo', name: 'Faroe Islands' },
  { code: 'fr', name: 'France' },
  { code: 'ga', name: 'Gabon' },
  { code: 'gd', name: 'Grenada' },
  { code: 'ge', name: 'Georgia' },
  { code: 'gf', name: 'French Guiana' },
  { code: 'gg', name: 'Guernsey' },
  { code: 'gh', name: 'Ghana' },
  { code: 'gi', name: 'Gibraltar' },
  { code: 'gl', name: 'Greenland' },
  { code: 'gm', name: 'Gambia' },
  { code: 'gn', name: 'Guinea' },
  { code: 'gp', name: 'Guadeloupe' },
  { code: 'gq', name: 'Equatorial Guinea' },
  { code: 'gr', name: 'Greece' },
  { code: 'gt', name: 'Guatemala' },
  { code: 'gu', name: 'Guam' },
  { code: 'gw', name: 'Guinea-Bissau' },
  { code: 'gy', name: 'Guyana' },
  { code: 'hk', name: 'Hong Kong' },
  { code: 'hn', name: 'Honduras' },
  { code: 'hr', name: 'Croatia' },
  { code: 'ht', name: 'Haiti' },
  { code: 'hu', name: 'Hungary' },
  { code: 'id', name: 'Indonesia' },
  { code: 'ie', name: 'Ireland' },
  { code: 'il', name: 'Israel' },
  { code: 'im', name: 'Isle of Man' },
  { code: 'in', name: 'India' },
  { code: 'iq', name: 'Iraq' },
  { code: 'ir', name: 'Iran' },
  { code: 'is', name: 'Iceland' },
  { code: 'it', name: 'Italy' },
  { code: 'je', name: 'Jersey' },
  { code: 'jm', name: 'Jamaica' },
  { code: 'jo', name: 'Jordan' },
  { code: 'jp', name: 'Japan' },
  { code: 'ke', name: 'Kenya' },
  { code: 'kg', name: 'Kyrgyzstan' },
  { code: 'kh', name: 'Cambodia' },
  { code: 'ki', name: 'Kiribati' },
  { code: 'km', name: 'Comoros' },
  { code: 'kn', name: 'Saint Kitts and Nevis' },
  { code: 'kr', name: 'South Korea' },
  { code: 'kw', name: 'Kuwait' },
  { code: 'ky', name: 'Cayman Islands' },
  { code: 'kz', name: 'Kazakhstan' },
  { code: 'la', name: 'Laos' },
  { code: 'lb', name: 'Lebanon' },
  { code: 'lc', name: 'Saint Lucia' },
  { code: 'li', name: 'Liechtenstein' },
  { code: 'lk', name: 'Sri Lanka' },
  { code: 'lr', name: 'Liberia' },
  { code: 'ls', name: 'Lesotho' },
  { code: 'lt', name: 'Lithuania' },
  { code: 'lu', name: 'Luxembourg' },
  { code: 'lv', name: 'Latvia' },
  { code: 'ly', name: 'Libya' },
  { code: 'ma', name: 'Morocco' },
  { code: 'mc', name: 'Monaco' },
  { code: 'md', name: 'Moldova' },
  { code: 'me', name: 'Montenegro' },
  { code: 'mf', name: 'Saint Martin' },
  { code: 'mg', name: 'Madagascar' },
  { code: 'mh', name: 'Marshall Islands' },
  { code: 'mk', name: 'North Macedonia' },
  { code: 'ml', name: 'Mali' },
  { code: 'mm', name: 'Myanmar' },
  { code: 'mn', name: 'Mongolia' },
  { code: 'mp', name: 'Northern Mariana Islands' },
  { code: 'mq', name: 'Martinique' },
  { code: 'mr', name: 'Mauritania' },
  { code: 'ms', name: 'Montserrat' },
  { code: 'mt', name: 'Malta' },
  { code: 'mu', name: 'Mauritius' },
  { code: 'mv', name: 'Maldives' },
  { code: 'mw', name: 'Malawi' },
  { code: 'mx', name: 'Mexico' },
  { code: 'my', name: 'Malaysia' },
  { code: 'mz', name: 'Mozambique' },
  { code: 'na', name: 'Namibia' },
  { code: 'nc', name: 'New Caledonia' },
  { code: 'ne', name: 'Niger' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'no', name: 'Norway' },
  { code: 'np', name: 'Nepal' },
  { code: 'nr', name: 'Nauru' },
  { code: 'nz', name: 'New Zealand' },
  { code: 'om', name: 'Oman' },
  { code: 'pa', name: 'Panama' },
  { code: 'pe', name: 'Peru' },
  { code: 'pf', name: 'French Polynesia' },
  { code: 'pg', name: 'Papua New Guinea' },
  { code: 'ph', name: 'Philippines' },
  { code: 'pk', name: 'Pakistan' },
  { code: 'pl', name: 'Poland' },
  { code: 'pm', name: 'St. Pierre and Miquelon' },
  { code: 'pr', name: 'Puerto Rico' },
  { code: 'ps', name: 'Palestine' },
  { code: 'pt', name: 'Portugal' },
  { code: 'pw', name: 'Palau' },
  { code: 'py', name: 'Paraguay' },
  { code: 'qa', name: 'Qatar' },
  { code: 're', name: 'Reunion' },
  { code: 'ro', name: 'Romania' },
  { code: 'rs', name: 'Serbia' },
  { code: 'rw', name: 'Rwanda' },
  { code: 'sa', name: 'Saudi Arabia' },
  { code: 'sb', name: 'Solomon Islands' },
  { code: 'sc', name: 'Seychelles' },
  { code: 'sd', name: 'Sudan' },
  { code: 'se', name: 'Sweden' },
  { code: 'sg', name: 'Singapore' },
  { code: 'si', name: 'Slovenia' },
  { code: 'sj', name: 'Svalbard' },
  { code: 'sk', name: 'Slovakia' },
  { code: 'sl', name: 'Sierra Leone' },
  { code: 'sm', name: 'San Marino' },
  { code: 'sn', name: 'Senegal' },
  { code: 'so', name: 'Somalia' },
  { code: 'sr', name: 'Suriname' },
  { code: 'ss', name: 'South Sudan' },
  { code: 'st', name: 'Sao Tome and Principe' },
  { code: 'sv', name: 'El Salvador' },
  { code: 'sx', name: 'Sint Maarten' },
  { code: 'sy', name: 'Syria' },
  { code: 'sz', name: 'Eswatini' },
  { code: 'tc', name: 'Turks and Caicos Islands' },
  { code: 'td', name: 'Chad' },
  { code: 'tg', name: 'Togo' },
  { code: 'th', name: 'Thailand' },
  { code: 'tj', name: 'Tajikistan' },
  { code: 'tk', name: 'Tokelau' },
  { code: 'tl', name: 'East Timor' },
  { code: 'tm', name: 'Turkmenistan' },
  { code: 'tn', name: 'Tunisia' },
  { code: 'to', name: 'Tonga' },
  { code: 'tr', name: 'Turkey' },
  { code: 'tt', name: 'Trinidad and Tobago' },
  { code: 'tv', name: 'Tuvalu' },
  { code: 'tw', name: 'Taiwan' },
  { code: 'tz', name: 'Tanzania' },
  { code: 'ua', name: 'Ukraine' },
  { code: 'ug', name: 'Uganda' },
  { code: 'uk', name: 'United Kingdom' },
  { code: 'us', name: 'United States' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'uz', name: 'Uzbekistan' },
  { code: 'va', name: 'Vatican' },
  { code: 'vc', name: 'Saint Vincent and the Grenadines' },
  { code: 've', name: 'Venezuela' },
  { code: 'vg', name: 'British Virgin Islands' },
  { code: 'vi', name: 'U.S. Virgin Islands' },
  { code: 'vn', name: 'Vietnam' },
  { code: 'vu', name: 'Vanuatu' },
  { code: 'wf', name: 'Wallis and Futuna' },
  { code: 'ws', name: 'Samoa' },
  { code: 'xk', name: 'Kosovo' },
  { code: 'ye', name: 'Yemen' },
  { code: 'yt', name: 'Mayotte' },
  { code: 'za', name: 'South Africa' },
  { code: 'zm', name: 'Zambia' },
  { code: 'zw', name: 'Zimbabwe' },
];

/**
 * Test if an audio stream is working (following redirects)
 */
async function testStream(url: string, depth = 0): Promise<boolean> {
  if (depth > 5) return false;
  return new Promise((resolve) => {
    try {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(
        url,
        {
          timeout: 10000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            Referer: 'https://onlineradiobox.com/',
          },
        },
        (res) => {
          if (
            res.statusCode &&
            [301, 302, 307, 308].includes(res.statusCode) &&
            res.headers.location
          ) {
            resolve(testStream(res.headers.location, depth + 1));
            res.destroy();
            return;
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            const contentType = res.headers['content-type'] || '';
            const isAudio =
              contentType.includes('audio') ||
              contentType.includes('mpeg') ||
              contentType.includes('octet-stream') ||
              res.statusCode === 200;
            resolve(isAudio);
          } else {
            resolve(false);
          }
          res.destroy();
        },
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Scrape stations from a specific page with retries
 */
async function scrapePage(page: Page, url: string, retries = 3): Promise<any[]> {
  for (let i = 0; i < retries; i++) {
    console.log(`Scraping: ${url} (Attempt ${i + 1}/${retries})`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      break; // Success
    } catch (e) {
      console.error(`Attempt ${i + 1} failed for ${url}:`, (e as Error).message);
      if (i === retries - 1) return [];
      // Wait a bit before retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return await page.evaluate(() => {
    const results: any[] = [];
    // Support multiple possible container selectors
    const stationElements = document.querySelectorAll(
      'li.stations__station, .tablelist .item, .stations-list li',
    );

    stationElements.forEach((li) => {
      const playBtn = li.querySelector('.station_play');
      if (playBtn) {
        const internalId = playBtn.getAttribute('radioid') || '';
        const name = playBtn.getAttribute('radioname') || '';
        const image = playBtn.getAttribute('radioimg') || '';
        const stream = playBtn.getAttribute('stream') || '';

        // Robust genre extraction
        const genreLinks = li.querySelectorAll(
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
          results.push({ id: internalId, name, image, stream, genres });
        }
      }
    });
    return results;
  });
}

/**
 * Scrape Online Radio Box for a specific country
 */
export async function scrapeORBForCountry(
  page: Page,
  countryCode: string,
  countryName: string,
  maxPages = 5,
) {
  const outputDir = path.join(process.cwd(), 'scraped_data', countryName);
  const outputFile = path.join(outputDir, `${PROVIDER}.json`);
  const baseUrl = `https://onlineradiobox.com/${countryCode}/`;

  console.log(`\n>>> Starting scrape for ${countryName} (${countryCode})...`);

  let pageNum = 0;
  let hasMore = true;
  let allStations: RadioStation[] = [];

  while (hasMore && pageNum < maxPages) {
    const url = `${baseUrl}?p=${pageNum}`;
    try {
      const scrapedData = await scrapePage(page, url);
      if (scrapedData.length === 0) {
        hasMore = false;
      } else {
        console.log(`Page ${pageNum} scraped. Testing ${scrapedData.length} stations...`);

        for (const data of scrapedData) {
          const isWorking = await testStream(data.stream);
          const status = isWorking ? 'working' : 'broken';

          const station: RadioStation = {
            id: `${PROVIDER}_${data.id}`,
            name: data.name || 'Unknown',
            image: data.image || '',
            stream_url: data.stream || '',
            provider: PROVIDER,
            country: countryName,
            genres: data.genres || [],
            language: [],
            status: status,
            last_tested_at: new Date(),
          };

          allStations.push(station);
          console.log(`[${status.toUpperCase()}] ${station.name}`);
        }

        hasMore = await page.evaluate(() => {
          const nextLink = Array.from(document.querySelectorAll('.pagination a')).find((a) =>
            a.textContent?.toLowerCase().includes('next'),
          );
          return !!nextLink;
        });
        if (hasMore) pageNum++;
      }
    } catch (error) {
      console.error(`Error on page ${pageNum}:`, error);
      hasMore = false;
    }
  }

  // Save to JSON file
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, JSON.stringify(allStations, null, 2));
  console.log(
    `Scraping complete for ${countryName}. Saved ${allStations.length} stations to ${outputFile}`,
  );
}

/**
 * Run scraper for all countries
 */
export async function scrapeAllORB() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  );

  for (const country of ORB_COUNTRIES) {
    try {
      await scrapeORBForCountry(page, country.code, country.name, 20); // Scrape first 20 pages per country
    } catch (err) {
      console.error(`Failed to scrape country ${country.name}:`, err);
    }
  }

  await browser.close();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length >= 2) {
    (async () => {
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      );
      await scrapeORBForCountry(page, args[0], args[1], parseInt(args[2] || '5'));
      await browser.close();
    })().catch(console.error);
  } else {
    scrapeAllORB().catch(console.error);
  }
}
