#!/usr/bin/env python3
import os
import json
import glob
import subprocess
import concurrent.futures
import argparse
from datetime import datetime, timezone

# Configuration
MAX_WORKERS = 40  # Number of parallel ffprobe checks
PROBE_TIMEOUT = 15  # Seconds to wait for each stream
OUTPUT_DIR = "src/radio/scrapers/metadata"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
REFERER = "https://onlineradiobox.com/"

def to_list(val):
    if not val: return []
    if isinstance(val, list): return val
    if isinstance(val, (set, tuple)): return list(val)
    if isinstance(val, str): return [val]
    return []

def validate_stream(station):
    """Use ffprobe to verify a stream and get technical metadata."""
    url = station.get("stream_url")
    if not url:
        return station

    try:
        # Added -user_agent to bypass simple bot protection/403s
        headers = f"Referer: {REFERER}\r\n"
        cmd = [
            "ffprobe", 
            "-user_agent", USER_AGENT,
            "-headers", headers,
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
                station["bitrate"] = str(s.get("bit_rate") or "")
                station["sample_rate"] = str(s.get("sample_rate") or "")
            else:
                station["status"] = "broken"
        else:
            station["status"] = "broken"
            
    except Exception:
        station["status"] = "broken"
    
    station["last_tested_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return station

def ingest_provider(provider_name, target_country=None, force_test=False, skip_test=False):
    # New Modular Path Structure
    scrapers_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    provider_data_dir = os.path.join(scrapers_root, "providers", provider_name, "data")
    iso_map_path = os.path.join(scrapers_root, "core", "countries_iso_map.json")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    if target_country:
        output_file = os.path.join(OUTPUT_DIR, f"validated_{provider_name}_{target_country.replace(' ', '_')}.json")
    else:
        output_file = os.path.join(OUTPUT_DIR, f"validated_{provider_name}.json")
    
    # Load Cache (Specific file first, then fallback to global provider file)
    cache = {}
    cache_sources = [output_file, os.path.join(OUTPUT_DIR, f"validated_{provider_name}.json")]
    for source in cache_sources:
        if os.path.exists(source):
            try:
                with open(source, 'r', encoding='utf-8') as f:
                    cached_data = json.load(f)
                    for s in cached_data:
                        if s.get("stream_url"): cache[s["stream_url"]] = s
                print(f"--- Loaded {len(cache)} stations from cache: {source} ---")
                break
            except: pass

    # Load ISO Mapping
    iso_map = {}
    if os.path.exists(iso_map_path):
        try:
            with open(iso_map_path, 'r', encoding='utf-8') as f:
                iso_map = json.load(f)
        except Exception: pass

    provider_library = {}
    cached_count = 0

    # Pattern: providers/{provider}/data/{ISO}.json
    if target_country:
        # If target_country is a name (e.g. "India"), we need its ISO code for the filename
        iso_code = iso_map.get(target_country, target_country).upper()
        search_pattern = os.path.join(provider_data_dir, f"{iso_code}.json")
    else:
        search_pattern = os.path.join(provider_data_dir, "*.json")

    files = glob.glob(search_pattern)
    if not files:
        print(f"No scraped data found for pattern: {search_pattern}")
        return

    print(f"--- Ingesting {provider_name} data from {len(files)} files ---")

    for file_path in files:
        try:
            # Filename is the ISO code (e.g. AD.json)
            file_iso = os.path.basename(file_path).replace(".json", "").upper()
            
            with open(file_path, 'r', encoding='utf-8') as f:
                stations = json.load(f)
                for station in stations:
                    url = (station.get("stream_url") or station.get("verified_url") or "").strip()
                    if not url: continue
                    
                    st_country = station.get("country")
                    # Use filename ISO as primary, fallback to looking up the name in the record
                    iso_code = file_iso if file_iso else iso_map.get(st_country, st_country)

                    if url not in provider_library:
                        existing = cache.get(url)
                        image = station.get("image") or station.get("image_url", "")
                        if image.startswith("//"): image = "https:" + image

                        entry = {
                            "id": station.get("id"),
                            "name": station.get("name", "Unknown"),
                            "image": image,
                            "stream_url": url,
                            "website": station.get("website") or "",
                            "provider": provider_name,
                            "country": st_country,
                            "countries": {iso_code},
                            "genres": set(to_list(station.get("genres", []))),
                            "languages": set(to_list(station.get("languages", []))),
                            "description": station.get("description", ""),
                            "status": "untested",
                            "codec": "unknown",
                        }

                        # Apply cache if working and not forced
                        if not force_test and existing and existing.get("status") == "working":
                            entry.update({
                                "status": "working",
                                "codec": existing.get("codec", "unknown"),
                                "bitrate": existing.get("bitrate"),
                                "sample_rate": existing.get("sample_rate"),
                                "last_tested_at": existing.get("last_tested_at")
                            })
                            if not entry["website"] and existing.get("website"):
                                entry["website"] = existing["website"]
                            cached_count += 1

                        provider_library[url] = entry
                    else:
                        entry = provider_library[url]
                        entry["countries"].add(iso_code)
                        entry["genres"].update(to_list(station.get("genres", [])))
                        entry["languages"].update(to_list(station.get("languages", [])))
                        if not entry["website"] and station.get("website"):
                            entry["website"] = station["website"]

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    stations_to_process = []
    for url, data in provider_library.items():
        data["countries"] = sorted(list(data["countries"]))
        data["genres"] = sorted(list(data["genres"]))
        data["languages"] = sorted(list(data["languages"]))
        stations_to_process.append(data)

    print(f"--- Found {len(stations_to_process)} unique stations ({cached_count} from cache) ---")
    
    # Validation Phase
    to_test = [s for s in stations_to_process if s["status"] == "untested"]
    if skip_test:
        print("--- Skipping validation phase as requested ---")
    elif to_test:
        print(f"--- Validating {len(to_test)} new/untested streams (Parallel {MAX_WORKERS}) ---")
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_station = {executor.submit(validate_stream, s): s for s in to_test}
            count = 0
            for future in concurrent.futures.as_completed(future_to_station):
                count += 1
                if count % 100 == 0:
                    print(f"Progress: {count}/{len(to_test)} tested...")
    else:
        print("--- All stations already validated in cache. Skipping test phase. ---")
        
    # Stats
    working = sum(1 for s in stations_to_process if s["status"] == "working")
    broken = sum(1 for s in stations_to_process if s["status"] == "broken")
    untested = sum(1 for s in stations_to_process if s["status"] == "untested")

    # Save
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(stations_to_process, f, indent=2, ensure_ascii=False)

    print("\n" + "="*50)
    print(f"INGESTION COMPLETE: {provider_name}")
    print("="*50)
    print(f"Working:  {working}")
    print(f"Broken:   {broken}")
    print(f"Untested: {untested}")
    print(f"File:     {output_file}")
    print("="*50)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Ingest and validate radio stations for a specific provider.')
    parser.add_argument('--provider', type=str, required=True, help='Name of the provider')
    parser.add_argument('--country', type=str, help='Filter to a specific country')
    parser.add_argument('-f', '--force-test', action='store_true', help='Re-validate even working streams')
    parser.add_argument('--skip-test', action='store_true', help='Skip validation entirely')
    
    args = parser.parse_args()
    ingest_provider(args.provider, args.country, args.force_test, args.skip_test)
