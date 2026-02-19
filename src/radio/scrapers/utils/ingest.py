#!/usr/bin/env python3
import os
import json
import glob
import subprocess
import concurrent.futures
import argparse
from datetime import datetime

# Configuration
MAX_WORKERS = 40  # Number of parallel ffprobe checks
PROBE_TIMEOUT = 10  # Seconds to wait for each stream
OUTPUT_DIR = "src/radio/scrapers/metadata"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"

def validate_stream(station):
    """Use ffprobe to verify a stream and get technical metadata."""
    url = station.get("stream_url")
    if not url:
        return station

    try:
        # Added -user_agent to bypass simple bot protection/403s
        cmd = [
            "ffprobe", 
            "-user_agent", USER_AGENT,
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,bit_rate,sample_rate",
            "-of", "json",
            url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=PROBE_TIMEOUT)
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if "streams" in data and len(data["streams"]) > 0:
                s = data["streams"][0]
                station["status"] = "working"
                station["codec"] = s.get("codec_name", "unknown")
                station["bitrate"] = s.get("bit_rate")
                station["sample_rate"] = s.get("sample_rate")
            else:
                station["status"] = "broken"
        else:
            # Check for common geo-block or server errors in stderr
            err_msg = result.stderr.lower()
            if "403 forbidden" in err_msg or "failed" in err_msg or "no route to host" in err_msg:
                station["status"] = "broken"
            else:
                station["status"] = "broken"
            
    except subprocess.TimeoutExpired:
        station["status"] = "broken"
    except Exception:
        station["status"] = "broken"
    
    station["last_tested_at"] = datetime.now().isoformat()
    return station

def ingest_provider(provider_name, target_country=None):
    scraped_dir = "scraped_data"
    iso_map_path = os.path.join(OUTPUT_DIR, "countries_iso_map.json")
    
    if target_country:
        output_file = os.path.join(OUTPUT_DIR, f"validated_{provider_name}_{target_country.replace(' ', '_')}.json")
    else:
        output_file = os.path.join(OUTPUT_DIR, f"validated_{provider_name}.json")
    
    # Load ISO Mapping
    try:
        with open(iso_map_path, 'r', encoding='utf-8') as f:
            iso_map = json.load(f)
    except Exception as e:
        print(f"Error loading ISO map: {e}")
        return

    # Dictionary to deduplicate internal provider results by URL
    provider_library = {}

    # Setup search pattern
    if target_country:
        search_pattern = os.path.join(scraped_dir, target_country, f"{provider_name}.json")
        print(f"--- Targeting specific country: {target_country} ---")
    else:
        search_pattern = os.path.join(scraped_dir, f"**/{provider_name}.json")

    files = glob.glob(search_pattern, recursive=True)
    
    if not files:
        print(f"No scraped data found for pattern: {search_pattern}")
        return

    print(f"--- Ingesting {provider_name} data from {len(files)} files ---")

    for file_path in files:
        try:
            folder_country = os.path.basename(os.path.dirname(file_path))
            iso_code = iso_map.get(folder_country, folder_country)

            with open(file_path, 'r', encoding='utf-8') as f:
                stations = json.load(f)
                for station in stations:
                    url = station.get("stream_url") or station.get("verified_url")
                    if not url: continue
                    
                    url = url.strip()
                    
                    if url not in provider_library:
                        provider_library[url] = {
                            "name": station.get("name", "Unknown"),
                            "image_url": station.get("image", ""),
                            "stream_url": url,
                            "countries": {iso_code},
                            "genres": set(station.get("genres", [])),
                            "provider_name": provider_name,
                            "provider_id": station.get("id"),
                            "status": "untested",
                            "codec": "unknown",
                            "languages": set(station.get("language", [])),
                        }
                    else:
                        entry = provider_library[url]
                        entry["countries"].add(iso_code)
                        if "genres" in station: entry["genres"].update(station["genres"])

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # Convert to list for validation
    stations_to_process = []
    for url, data in provider_library.items():
        data["countries"] = sorted(list(data["countries"]))
        data["genres"] = sorted(list(data["genres"]))
        data["languages"] = sorted(list(data["languages"]))
        stations_to_process.append(data)

    print(f"--- Found {len(stations_to_process)} unique stations for {provider_name} ---")
    
    # Validation Phase
    if stations_to_process:
        print(f"--- Validating streams (Parallel {MAX_WORKERS}) User-Agent active ---")
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_station = {executor.submit(validate_stream, s): s for s in stations_to_process}
            count = 0
            for future in concurrent.futures.as_completed(future_to_station):
                count += 1
                if count % 100 == 0:
                    print(f"Progress: {count}/{len(stations_to_process)} tested...")
        
    # Save Validated Provider File
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(stations_to_process, f, indent=2, ensure_ascii=False)

    print("\n" + "="*50)
    print(f"VALIDATION COMPLETE")
    print("="*50)
    print(f"Total Unique: {len(stations_to_process)}")
    print(f"Validated file saved: {output_file}")
    print("="*50)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Ingest and validate radio stations for a specific provider.')
    parser.add_argument('--provider', type=str, required=True, help='Name of the provider (e.g., onlineradiobox, mytuner)')
    parser.add_argument('--country', type=str, help='Filter ingestion to a specific country (e.g., "United States")')
    
    args = parser.parse_args()
    ingest_provider(args.provider, args.country)
