#!/usr/bin/env python3
import os
import json
import glob
from collections import defaultdict

def ingest_stations():
    scraped_dir = "scraped_data"
    output_dir = "src/radio/scrapers/metadata"
    iso_map_path = os.path.join(output_dir, "countries_iso_map.json")
    
    # Load ISO Mapping
    try:
        with open(iso_map_path, 'r', encoding='utf-8') as f:
            iso_map = json.load(f)
    except Exception as e:
        print(f"Error loading ISO map: {e}")
        return

    # Unified Master Dictionary (Key: Playback URL)
    master_library = {}
    total_raw_entries = 0
    skipped_no_url = 0

    # Find all JSON files
    files = glob.glob(os.path.join(scraped_dir, "**/*.json"), recursive=True)
    print(f"Ingesting data from {len(files)} files...")

    for file_path in files:
        # Only process scrapers
        if not (file_path.endswith("onlineradiobox.json") or file_path.endswith("mytuner.json")):
            continue
            
        try:
            folder_country = os.path.basename(os.path.dirname(file_path))
            iso_code = iso_map.get(folder_country, folder_country) # Fallback to original if not mapped

            with open(file_path, 'r', encoding='utf-8') as f:
                stations = json.load(f)
                
                for station in stations:
                    total_raw_entries += 1
                    url = None
                    
                    # 1. Extract the best URL
                    if "stream_url" in station: # ORB
                        url = station["stream_url"]
                    elif "verified_url" in station: # MyTuner verified
                        url = station["verified_url"]
                    elif "streams" in station and station["streams"]: # MyTuner raw fallback
                        url = station["streams"][0].get("url")
                    
                    if not url:
                        skipped_no_url += 1
                        continue
                    
                    url = url.strip()
                    provider = station.get("provider", "unknown")
                    
                    if url not in master_library:
                        # NEW STATION
                        master_library[url] = {
                            "name": station.get("name", "Unknown"),
                            "image": station.get("image", ""),
                            "stream_url": url,
                            "countries": {iso_code}, # Use a set for uniqueness
                            "genres": set(station.get("genres", [])),
                            "providers": {provider: station.get("id")},
                            "status": station.get("status", "unknown"),
                            "languages": set(station.get("language", [])),
                        }
                    else:
                        # EXISTING STATION - MERGE DATA
                        entry = master_library[url]
                        
                        # Use longest name (usually more detailed)
                        curr_name = station.get("name", "")
                        if len(curr_name) > len(entry["name"]):
                            entry["name"] = curr_name
                        
                        # Prefer https images if both exist
                        curr_image = station.get("image", "")
                        if curr_image.startswith("https") and not entry["image"].startswith("https"):
                            entry["image"] = curr_image
                        
                        # Merge lists
                        entry["countries"].add(iso_code)
                        if "genres" in station:
                            entry["genres"].update(station["genres"])
                        if "language" in station:
                            entry["languages"].update(station["language"])
                            
                        # Add provider reference
                        entry["providers"][provider] = station.get("id")
                        
                        # Update status (favor 'working' if any source says it works)
                        if station.get("status") == "working":
                            entry["status"] = "working"

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # Convert sets back to sorted lists for JSON serialization
    final_list = []
    for url, data in master_library.items():
        data["countries"] = sorted(list(data["countries"]))
        data["genres"] = sorted(list(data["genres"]))
        data["languages"] = sorted(list(data["languages"]))
        final_list.append(data)

    # Save Master File
    master_file_path = os.path.join(output_dir, "master_stations.json")
    with open(master_file_path, 'w', encoding='utf-8') as f:
        json.dump(final_list, f, indent=2, ensure_ascii=False)

    print("\n" + "="*50)
    print("           INGESTION COMPLETE")
    print("="*50)
    print(f"Total raw entries:      {total_raw_entries}")
    print(f"Skipped (no URL):       {skipped_no_url}")
    print(f"Normalized Unique:      {len(final_list)}")
    print(f"Master file saved:      {master_file_path}")
    print("="*50)

if __name__ == "__main__":
    ingest_stations()
