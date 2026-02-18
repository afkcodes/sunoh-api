#!/usr/bin/env python3
import os
import json
import glob
import subprocess
import concurrent.futures
from collections import defaultdict
from datetime import datetime

# Configuration
MAX_WORKERS = 40  # Number of parallel ffprobe checks
PROBE_TIMEOUT = 10  # Seconds to wait for each stream
OUTPUT_DIR = "src/radio/scrapers/metadata"
MASTER_FILE = os.path.join(OUTPUT_DIR, "master_stations.json")

def validate_stream(station):
    """Use ffprobe to verify a stream and get technical metadata."""
    url = station.get("stream_url")
    if not url:
        return station

    try:
        # We ask for codec, bitrate, and sample rate
        cmd = [
            "ffprobe", 
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
            station["status"] = "broken"
            
    except subprocess.TimeoutExpired:
        station["status"] = "broken"
    except Exception:
        station["status"] = "broken"
    
    station["last_tested_at"] = datetime.now().isoformat()
    return station

def ingest_stations():
    scraped_dir = "scraped_data"
    iso_map_path = os.path.join(OUTPUT_DIR, "countries_iso_map.json")
    
    # Load ISO Mapping
    try:
        with open(iso_map_path, 'r', encoding='utf-8') as f:
            iso_map = json.load(f)
    except Exception as e:
        print(f"Error loading ISO map: {e}")
        return

    # Load existing master if it exists (for caching validation)
    existing_master = {}
    if os.path.exists(MASTER_FILE):
        try:
            with open(MASTER_FILE, 'r', encoding='utf-8') as f:
                for s in json.load(f):
                    existing_master[s["stream_url"]] = s
        except: pass

    # Unified Master Dictionary (Key: Playback URL)
    master_library = {}
    total_raw_entries = 0

    # Find all JSON files
    files = glob.glob(os.path.join(scraped_dir, "**/*.json"), recursive=True)
    print(f"--- Ingesting data from {len(files)} files ---")

    for file_path in files:
        if not (file_path.endswith("onlineradiobox.json") or file_path.endswith("mytuner.json")):
            continue
            
        try:
            folder_country = os.path.basename(os.path.dirname(file_path))
            iso_code = iso_map.get(folder_country, folder_country)

            with open(file_path, 'r', encoding='utf-8') as f:
                stations = json.load(f)
                for station in stations:
                    total_raw_entries += 1
                    url = station.get("stream_url") or station.get("verified_url")
                    if not url: continue
                    
                    url = url.strip()
                    provider = station.get("provider", "unknown")
                    
                    if url not in master_library:
                        master_library[url] = {
                            "name": station.get("name", "Unknown"),
                            "image": station.get("image", ""),
                            "stream_url": url,
                            "countries": {iso_code},
                            "genres": set(station.get("genres", [])),
                            "providers": {provider: station.get("id")},
                            "status": "untested",
                            "codec": "unknown",
                            "languages": set(station.get("language", [])),
                        }
                        # If we already have validation data for this URL, preserve it
                        if url in existing_master:
                            master_library[url].update({
                                "status": existing_master[url].get("status", "untested"),
                                "codec": existing_master[url].get("codec", "unknown"),
                                "bitrate": existing_master[url].get("bitrate"),
                                "sample_rate": existing_master[url].get("sample_rate"),
                                "last_tested_at": existing_master[url].get("last_tested_at")
                            })
                    else:
                        entry = master_library[url]
                        entry["countries"].add(iso_code)
                        if "genres" in station: entry["genres"].update(station["genres"])
                        entry["providers"][provider] = station.get("id")

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # Convert to list for processing
    unique_stations = []
    for url, data in master_library.items():
        data["countries"] = sorted(list(data["countries"]))
        data["genres"] = sorted(list(data["genres"]))
        data["languages"] = sorted(list(data["languages"]))
        unique_stations.append(data)

    # Validation Phase
    to_validate = [s for s in unique_stations if s["status"] == "untested" or s["status"] == "broken"]
    print(f"--- Found {len(unique_stations)} unique stations ---")
    print(f"--- Validating {len(to_validate)} stations (Parallel {MAX_WORKERS}) ---")

    if to_validate:
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_station = {executor.submit(validate_stream, s): s for s in to_validate}
            count = 0
            for future in concurrent.futures.as_completed(future_to_station):
                count += 1
                if count % 100 == 0:
                    print(f"Progress: {count}/{len(to_validate)} tested...")
        
    # Save Final Master
    with open(MASTER_FILE, 'w', encoding='utf-8') as f:
        json.dump(unique_stations, f, indent=2, ensure_ascii=False)

    print("\n" + "="*50)
    print(f"INGESTION & VALIDATION COMPLETE")
    print("="*50)
    print(f"Total Unique: {len(unique_stations)}")
    print(f"Master saved to: {MASTER_FILE}")
    print("="*50)

if __name__ == "__main__":
    ingest_stations()
