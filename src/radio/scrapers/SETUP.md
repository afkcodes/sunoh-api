# Sunoh Radio Scraper: Server Setup Guide

This guide explains how to set up and run the global radio station scraper on a Linux server (Ubuntu/Debian recommended).

## 1. System Requirements

Since you already have Node.js installed, you only need to install the multimedia and data tools. **Do not** attempt to install `nodejs` or `npm` via `apt` if you already have them, as it will cause version conflicts.

Run this:
```bash
sudo apt update
sudo apt install -y ca-certificates jq python3 ffmpeg
```

*(Note: If you don't have Node.js yet, use [Nodesource](https://github.com/nodesource/distributions) or NVM instead of apt).*

## 2. Project Installation

Once you have cloned the repository, install the Node.js dependencies:

```bash
npm install
```

### Install Headless Chrome
Since the scrapers use Puppeteer, you must install the Linux browser dependencies:

```bash
npx puppeteer browsers install chrome
```

## 3. Running the Scrapers

The system is designed to skip countries you have already scraped (those in `scraped_data/`).

### Start a Full Scrape
To scrape all countries in parallel (default 5 at a time):

```bash
# It is recommended to run this inside a 'screen' or 'tmux' session
./src/radio/scrapers/run_all.sh
```

### Scrape a Specific Country manually
If you want to re-run or test a single country:

```bash
# Usage: ./onlineradiobox.sh [country_code] [country_name]
./src/radio/scrapers/onlineradiobox/onlineradiobox.sh "us" "United States"
```

## 4. Generating the Master Library (Ingestion)

After scraping is finished, merge all individual country files into one deduplicated master list:

```bash
python3 src/radio/scrapers/utils/ingest.py
```

- **Output**: `src/radio/scrapers/metadata/master_stations.json`
- This file is ready to be imported into your database.

## 5. Helpful Utilities

| Command | Description |
|---------|-------------|
| `./src/radio/scrapers/utils/count_stations.sh` | Shows a live table of how many stations are found per country. |
| `python3 src/radio/scrapers/utils/count_unique.py` | Shows how many unique stations exist after deduplication. |

## Pro-Tips for Servers:
1. **Background Running**: Always run the scraper inside `screen` or `tmux`. It takes time, and you don't want it to die if your SSH connection drops.
2. **Headless Mode**: The scripts are already configured with `--aout=dummy --vout=dummy` so they won't try to open windows or play sound on your server.
3. **Cron Job**: You can set up a Cron Job to run the `run_all.sh` once a week to automatically keep your radio library updated.
