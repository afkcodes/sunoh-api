#!/usr/bin/env python3
import subprocess
import json
import argparse
import sys
from datetime import datetime

# Configuration
DEFAULT_TIMEOUT = 15
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
REFERER = "https://onlineradiobox.com/"

def validate_stream(url, timeout=DEFAULT_TIMEOUT):
    """
    Use ffprobe to verify a stream and get technical metadata.
    Returns a dictionary with status, codec, bitrate, and sample_rate.
    """
    if not url:
        return {"status": "broken", "error": "No URL provided"}

    try:
        # Added -user_agent and -headers for referer to bypass bot protection
        # We use a combined headers string for ffprobe
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
        
        # Run ffprobe with a timeout
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if "streams" in data and len(data["streams"]) > 0:
                s = data["streams"][0]
                return {
                    "status": "working",
                    "codec": s.get("codec_name", "unknown"),
                    "bitrate": s.get("bit_rate"),
                    "sample_rate": s.get("sample_rate"),
                    "last_tested_at": datetime.now().isoformat()
                }
            else:
                return {"status": "broken", "error": "No audio streams found", "last_tested_at": datetime.now().isoformat()}
        else:
            err_msg = result.stderr.strip() or "Unknown ffprobe error"
            return {"status": "broken", "error": err_msg, "last_tested_at": datetime.now().isoformat()}
            
    except subprocess.TimeoutExpired:
        return {"status": "broken", "error": f"Timeout after {timeout}s", "last_tested_at": datetime.now().isoformat()}
    except Exception as e:
        return {"status": "broken", "error": str(e), "last_tested_at": datetime.now().isoformat()}

def main():
    parser = argparse.ArgumentParser(description='Validate a radio stream URL using ffprobe.')
    parser.add_argument('url', type=str, help='The stream URL to test')
    parser.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT, help='Timeout in seconds')
    parser.add_argument('--json', action='store_true', help='Output results as JSON')

    args = parser.parse_args()

    result = validate_stream(args.url, timeout=args.timeout)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result["status"] == "working":
            print(f"\033[1;32m[WORKING]\033[0m {args.url}")
            print(f"  Codec: {result.get('codec')}")
            print(f"  Bitrate: {result.get('bitrate')} bps")
            print(f"  Sample Rate: {result.get('sample_rate')} Hz")
        else:
            print(f"\033[1;31m[BROKEN]\033[0m {args.url}")
            print(f"  Error: {result.get('error')}")

if __name__ == "__main__":
    main()
