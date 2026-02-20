#!/usr/bin/env python3
import os
import json
import glob
from collections import defaultdict

def count_unique_stations():
    scraped_dir = "scraped_data"
    all_recordings = defaultdict(list)
    total_entries = 0
    
    # Files to process
    files = glob.glob(os.path.join(scraped_dir, "**/*.json"), recursive=True)
    
    print(f"Scanning {len(files)} files...")
    
    for file_path in files:
        if not (file_path.endswith("onlineradiobox.json") or file_path.endswith("mytuner.json")):
            continue
            
        try:
            country = os.path.basename(os.path.dirname(file_path))
            source_type = os.path.basename(file_path)
            
            with open(file_path, 'r', encoding='utf-8') as f:
                stations = json.load(f)
                
                for station in stations:
                    total_entries += 1
                    url = None
                    
                    if "stream_url" in station:
                        url = station["stream_url"]
                    elif "verified_url" in station:
                        url = station["verified_url"]
                    elif "streams" in station and station["streams"]:
                        url = station["streams"][0].get("url")
                    
                    if url:
                        url = url.strip()
                        all_recordings[url].append({
                            "name": station.get("name", "Unknown"),
                            "country": country,
                            "source": source_type,
                            "file": file_path
                        })
        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # Identify true duplicates (URLs with > 1 occurrence)
    duplicates = {url: records for url, records in all_recordings.items() if len(records) > 1}
    
    output_path = "src/radio/scrapers/metadata/duplicates.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(duplicates, f, indent=2, ensure_ascii=False)

    print("\n" + "="*50)
    print("      UNIQUE RADIO STATION SUMMARY")
    print("="*50)
    print(f"Total entries processed: {total_entries}")
    print(f"Unique playback URLs:    {len(all_recordings)}")
    print(f"Duplicate URLs found:    {len(duplicates)}")
    print(f"Duplicate report saved:  {output_path}")
    print("="*50)
    
    if all_recordings:
        redundancy = (total_entries - len(all_recordings)) / total_entries * 100
        print(f"Redundancy rate:         {redundancy:.2f}%")
        print("="*50)

if __name__ == "__main__":
    count_unique_stations()
