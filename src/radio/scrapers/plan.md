# Radio Scraper & Ingestion: Modular Workflow Plan

This document outlines the professional, multi-provider strategy for building the global Sunoh Radio Library.

## 1. Core Objective
To build a scalable radio station database from multiple independent providers (OnlineRadioBox, MyTuner, TuneIn, etc.) while maintaining high data integrity, accurate stream validation (codecs), and automatic deduplication at the database level.

---

## 2. Updated Database Schema
The database (PostgreSQL) will serve as the final "Source of Truth." To handle multiple providers for the same station, the schema must be updated.

### `radio_stations` Table
- `id`: Primary Key (Auto-increment).
- `name`: Station Name (Merged from providers).
- `image_url`: URL to the source image (external).
- `image_hosted`: URL to the hosted image (e.g., ImageKit/Cloudinary).
- `stream_url`: **UNIQUE KEY**. The deduplication anchor.
- `providers`: JSONB. Mapping of `provider_name -> internal_id`.
- `countries`: TEXT[]. List of ISO alpha-2 codes.
- `genres`: TEXT[]. Unified list of genres.
- `status`: working / broken / untested.
- `codec`: Detected audio format.
- `bitrate`: Detected bitrate.
- `sample_rate`: Detected sample rate.
- `failure_count`: INTEGER. Track consecutive validation failures.
- `is_verified`: BOOLEAN. Manual override to protect major stations (e.g. Mirchi, BBC).
- `last_tested_at`: Timestamp of last test.
- `metadata`: JSONB.

---

## 3. The Modular Workflow
Instead of one giant run, we process providers one-by-one to ensure stability.

### Step A: Provider Scraping
**Script**: `[provider].sh` + `[provider]_fetcher.js`
- **Action**: Fast raw scrape of one specific provider.
- **Output**: `scraped_data/[Country]/[provider].json`.
- **Constraint**: No stream validation at this stage to maximize speed.

### Step B: Provider Ingestion & Validation (VPN Optimized)
**Script**: `ingest.py --provider [name] [--country "Name"]`
- **Action**: 
    1. Collect all JSON files for this specific provider. 
    2. **Geo-Block Strategy**: Use the `--country` flag to process one country at a time while connected to a **Proton VPN** server for that region.
    3. Remove internal duplicates.
    4. Run **Parallel FFprobe** checks with **User-Agent Spoofing** to bypass bot-checks and extract high-fidelity technical metadata.
- **Output**: A clean, validated JSON file ready for sync.

### Step C: Database Synchronization (Upsert)
**Script**: `sync_to_db.py`
- **Action**: Use `INSERT ... ON CONFLICT (stream_url) DO UPDATE`.
- **Merge Logic**:
    - **Name**: Prefer the longest/most descriptive name.
    - **Image**: **Smart Selection**. Prefer HTTPS and compare dimensions or resolutions where possible.
    - **Providers**: Merge the new provider ID into the existing `providers` JSONB object.
    - **Genres/Countries**: Union existing lists with the new data.
    - **Resilience Policy (The Death Timer)**:
        - If `is_verified` is true: **Never** mark as broken automatically.
        - If validation fails: Increment `failure_count`. Only mark as `broken` if `failure_count >= 3`.
        - If validation succeeds: Reset `failure_count` to 0.

### Step D: Media Hosting (ImageKit/CDN Integration)
**Script**: `host_images.py`
- **Action**: 
    1. Scan DB for stations where `image_hosted` is NULL.
    2. Download the `image_url` to a temporary buffer.
    3. Upload to **ImageKit** (using ID as filename).
    4. Update the DB with the new `image_hosted` URL.
- **Benefit**: High bandwidth and optimized image delivery for 30k+ icons.

---

## 4. Why This Works
1. **Resilience**: The "Death Timer" prevents temporary server blips from deleting stations from the library.
2. **Media Stability**: By hosting images ourselves, we aren't dependent on the scraper source websites staying online.
3. **Manual Control**: Important stations (Mirchi, BBC) are "protected" from automated failures using the `is_verified` flag.
4. **Data Quality**: Smart image selection ensures your App always has the highest quality logos.

---

## 5. Implementation Roadmap
1. [ ] **Update DB Schema**: Modify `initDb.ts` to support the multi-provider JSONB structure.
2. [ ] **Refine Ingester**: Modify `ingest.py` to accept a `--provider` argument and output clean, validated datasets.
3. [ ] **Build Sync Script**: create a database uploader that handles the sophisticated `ON CONFLICT` merge logic.
4. [ ] **Deployment**: Set up a CRON job on the server to run this cycle for new providers.
