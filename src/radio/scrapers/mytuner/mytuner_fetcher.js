const puppeteer = require('puppeteer');

async function fetchMyTuner(urls, mode = 'station') {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Optimization: Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type) || req.url().includes('google') || req.url().includes('facebook')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    for (const url of urls) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            if (mode === 'country') {
                await page.waitForSelector('a.no-select', { timeout: 10000 });
                
                const data = await page.evaluate(() => {
                    const decodeHtml = (html) => {
                        const txt = document.createElement("textarea");
                        txt.innerHTML = html;
                        return txt.value;
                    };
                    const stations = Array.from(document.querySelectorAll('a.no-select')).map(a => ({
                        name: decodeHtml(a.querySelector('span')?.textContent?.trim() || a.innerText.trim()),
                        url: a.href,
                        id: a.href.split('-').pop().replace('/', '')
                    }));
                    
                    const nextBtn = document.querySelector('ul.pagination li.active + li a');
                    return {
                        stations,
                        hasMore: !!nextBtn,
                        nextPage: nextBtn ? nextBtn.href : null
                    };
                });
                console.log(JSON.stringify(data));
            } else {
                // Individual Station Mode
                try {
                    await page.waitForFunction(() => typeof window._playlist !== 'undefined' && Array.isArray(window._playlist) && window._playlist.length > 0 && !window._playlist[0].cipher, { timeout: 10000 });
                } catch(e) {
                    // Fallback or skip
                }

                const data = await page.evaluate(() => {
                    const decodeHtml = (html) => {
                        const txt = document.createElement("textarea");
                        txt.innerHTML = html;
                        return txt.value;
                    };
                    return {
                        id: window.radio_id,
                        name: decodeHtml(window.radio_name),
                        image: window.radio_image,
                        streams: (window._playlist || []).map(s => ({
                            url: s.file,
                            type: s.type
                        })),
                        genres: Array.from(document.querySelectorAll('a[href*="/radio/genre/"]')).map(a => a.textContent.trim()),
                        country: document.querySelector('a[href*="/radio/country/"]')?.textContent?.trim(),
                        url: window.location.href
                    };
                });
                console.log(JSON.stringify(data));
            }
        } catch (e) {
            console.error(JSON.stringify({ error: e.message, url }));
        }
    }
    
    await browser.close();
}

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error("Usage: node mytuner_fetcher.js <url_or_urls> [mode: country|station]");
    process.exit(1);
}

// Support multiple URLs separated by comma or file input
const mode = args[1] || 'station';
const input = args[0];
const urls = input.includes(',') ? input.split(',') : [input];

fetchMyTuner(urls, mode);
