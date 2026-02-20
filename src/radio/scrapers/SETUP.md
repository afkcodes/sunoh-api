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

## 3. Directory Structure

The project follows a modular, provider-isolated architecture:

```text
src/radio/scrapers/
├── core/               # Shared settings & country mapping
├── providers/          # Individual website scrapers
│   └── onlineradiobox/
│       ├── onlineradiobox.sh
│       └── data/      # Raw scraped JSONs (ISO-named)
├── scripts/            # Orchestration & Ingestion
└── metadata/           # Final validated databases
```

## 4. Running the Scrapers

The system is designed to skip countries you have already scraped (those in the provider's `data/` folder).

### Start a Full Scrape
To scrape all countries in parallel (default 5 at a time):

```bash
# It is recommended to run this inside a 'screen' or 'tmux' session
./src/radio/scrapers/run_all.sh
```

### Scrape a Specific Country manually
```bash
# Usage: ./onlineradiobox.sh [country_code] [country_name]
./src/radio/scrapers/providers/onlineradiobox/onlineradiobox.sh "us" "United States"
```

## 5. Generating the Master Library (Ingestion)

After scraping is finished, merge all individual files into a deduplicated master list. This script uses smart caching to reuse previous validation results (**speeds up re-scrapes by 100x**).

```bash
python3 src/radio/scrapers/scripts/ingest.py --provider onlineradiobox
```

- **Output**: `src/radio/scrapers/metadata/validated_onlineradiobox.json`
- This file is ready for database sync.

## 6. Helpful Utilities

| Command | Description |
|---------|-------------|
| `./src/radio/scrapers/scripts/count_stations.sh` | Shows a live table of how many stations are found per country. |
| `python3 src/radio/scrapers/scripts/count_unique.py` | Shows how many unique stations exist after deduplication. |

## Pro-Tips for Servers:
1. **Background Running**: Always run the scraper inside `screen` or `tmux`. It takes time, and you don't want it to die if your SSH connection drops.
2. **Headless Mode**: The scripts are already configured to run in headless mode.
3. **Cron Job**: You can set up a Cron Job to run the `run_all.sh` once a week to automatically keep your radio library updated.
