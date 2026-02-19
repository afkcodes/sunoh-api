import urllib.request
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

# You.Radio API Scraper
API_URL = "https://manager.uber.radio/api/public/station"
IMAGE_BASE = "https://you.radio/cdn-cgi/image/width=300,quality=80/https://manager.uber.radio/static/uploads/station/"
OUTPUT_DIR = "scraped_data/YouRadio"
OUTPUT_FILE = f"{OUTPUT_DIR}/youradio.json"

# Colors
GREEN = '\033[1;32m'
RED = '\033[1;31m'
CYAN = '\033[1;36m'
YELLOW = '\033[1;33m'
NC = '\033[0m'

os.makedirs(OUTPUT_DIR, exist_ok=True)

def validate_stream(url):
    """Validate if the stream is working using ffprobe."""
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    cmd = [
        "ffprobe", 
        "-user_agent", ua,
        "-v", "error", 
        "-select_streams", "a:0", 
        "-show_entries", "stream=codec_name", 
        "-of", "default=noprint_wrappers=1:nokey=1", 
        url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout.strip().lower()
        if output and "error" not in output and "fail" not in output:
            return "working", output
    except:
        pass
    return "broken", "unknown"

def extract_tags(pinecone_text):
    """Parse genres, decades, and moods from the pinecone_search_text field."""
    if not pinecone_text:
        return []
    tags = []
    lines = pinecone_text.split('\n')
    for line in lines:
        if ':' in line:
            parts = line.split(':', 1)
            if len(parts) == 2:
                key = parts[0].strip().upper()
                val = parts[1].strip()
                if key in ['GENRES', 'DECADES', 'MOODS']:
                    items = [i.strip() for i in val.split(',') if i.strip()]
                    tags.extend(items)
    return list(dict.fromkeys(tags)) # Remove duplicates while preserving order

def process_station(s):
    name = s.get("name", "Unknown")
    stream = s.get("stream_url") or s.get("stream_url_app")
    logo_filename = s.get("logo")
    
    if not stream:
        return None
    
    status, codec = validate_stream(stream)
    
    if status == "broken":
        print(f"{RED}[BROKEN]{NC} {name}")
    else:
        print(f"{GREEN}[WORKING]{NC} {name} ({codec})")

    # Extract rich tags from search text
    pinecone = s.get("pinecone_search_text")
    tags = extract_tags(pinecone)
    
    # Use brand name as fallback or supplementary tag
    brand_name = s.get("brand", {}).get("name")
    if brand_name and brand_name not in tags:
        tags.append(brand_name)

    # Map to our standard format
    return {
        "id": f"youradio_{s.get('id')}",
        "name": name,
        "image": f"{IMAGE_BASE}{logo_filename}" if logo_filename else "",
        "stream_url": stream,
        "provider": "youradio",
        "country": "Global",
        "genres": tags,
        "description": s.get("seo_description", ""),
        "status": status,
        "codec": codec,
        "last_tested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def main():
    print(f"{CYAN}Fetching You.Radio (Exclusive Radio) Stations...{NC}")
    req = urllib.request.Request(API_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        stations_raw = json.loads(response.read().decode())
    print(f"Found {len(stations_raw)} stations.")

    results = []
    # Using ThreadPool to validate streams in parallel (limited to 10 workers to be polite)
    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(process_station, stations_raw))

    # Filter out None values
    final_stations = [r for r in results if r]
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(final_stations, f, indent=2)

    print(f"\n{GREEN}Saved {len(final_stations)} stations to {OUTPUT_FILE}{NC}")

if __name__ == "__main__":
    main()
