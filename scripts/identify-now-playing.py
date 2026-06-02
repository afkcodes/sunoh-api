#!/usr/bin/env python3
"""
identify-now-playing.py

Phase 1 prototype: take a radio stream URL, sample N seconds via ffmpeg,
run Shazam recognition, print the result as JSON. Standalone — does NOT
hit Postgres / Redis / anything else in the sunoh-api stack. Goal is to
validate that Shazam actually matches the audio we'd capture from real
internet-radio streams (HLS / AAC / MP3) before we plumb a worker + a
/radios/:slug/now-playing endpoint.

Once we have a feel for match-rate, timing, and image quality across a
sample of stations, we'll decide between (a) shelling out from Node to
this script in-process, (b) running shazamio behind a tiny FastAPI
sidecar in docker-compose, or (c) staying all-Node with `node-shazam`.

Usage:
    pip install shazamio                                # one-time
    python3 scripts/identify-now-playing.py <stream_url> [--seconds 5]

Args:
    url             radio stream URL (HLS / m3u8 / mp3 / aac — anything ffmpeg can demux)
    --seconds N     sample length, default 5. Shazam can match on as little as 3s,
                    but 5–7s is the sweet spot — improves match rate noticeably without
                    paying much more wall clock.
    --timeout N     overall per-step timeout in seconds, default 20.
    --no-headers    skip the UA/Referer headers ffmpeg sends to the stream — useful
                    if a station rejects spoofed Chrome UAs (rare but happens).

Output (JSON to stdout):
    {
      "matched": bool,
      "track": { title, artist, album, image, shazam_id, isrc, genres } | null,
      "timing": { capture_ms, recognize_ms, total_ms },
      "error": string | null
    }
"""

import argparse
import asyncio
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Same Chrome UA + onlineradiobox referer sunoh-radio's validate_stream.py uses
# — a handful of broadcasters bot-block the default ffmpeg UA, this spoof gets
# past most of them.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/91.0.4472.124 Safari/537.36"
)
REFERER = "https://onlineradiobox.com/"


def _safe_meta(track: dict, name: str):
    """Pull a labelled metadata field (Album / Released / Label / …) out of
    Shazam's nested `track.sections[].metadata[]` shape."""
    sections = track.get("sections") or []
    for s in sections:
        for m in s.get("metadata") or []:
            if m.get("title") == name:
                return m.get("text")
    return None


async def capture_and_recognize(url: str, seconds: int, timeout: int, use_headers: bool) -> dict:
    t0 = time.monotonic()
    out = {
        "matched": False,
        "track": None,
        "timing": {},
        "error": None,
    }

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "sample.wav"

        # ffmpeg: fixed-length capture, downmixed to 16kHz mono PCM. shazamio
        # resamples internally so format isn't strictly load-bearing — but
        # 16k mono cuts the file size ~5× vs. 44k stereo, which shaves a few
        # tens of ms off shazamio's read path.
        cmd = [
            "ffmpeg",
            "-loglevel", "error",
        ]
        if use_headers:
            cmd += [
                "-user_agent", UA,
                "-headers", f"Referer: {REFERER}\r\n",
            ]
        cmd += [
            "-t", str(seconds),
            "-i", url,
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            "-y", str(wav_path),
        ]

        t_cap = time.monotonic()
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            out["error"] = f"ffmpeg timed out after {timeout}s"
            out["timing"]["total_ms"] = int((time.monotonic() - t0) * 1000)
            return out
        out["timing"]["capture_ms"] = int((time.monotonic() - t_cap) * 1000)

        if r.returncode != 0:
            out["error"] = "ffmpeg: " + r.stderr.decode("utf-8", errors="ignore")[:300].strip()
            out["timing"]["total_ms"] = int((time.monotonic() - t0) * 1000)
            return out
        if not wav_path.exists() or wav_path.stat().st_size < 1024:
            out["error"] = "ffmpeg produced an empty / truncated sample"
            out["timing"]["total_ms"] = int((time.monotonic() - t0) * 1000)
            return out

        # Lazy import — keeps `--help` and arg-parse errors fast (shazamio
        # pulls in numpy at import).
        from shazamio import Shazam

        shazam = Shazam()
        t_rec = time.monotonic()
        try:
            res = await asyncio.wait_for(
                shazam.recognize(str(wav_path)), timeout=timeout
            )
        except asyncio.TimeoutError:
            out["error"] = f"shazam recognize timed out after {timeout}s"
            out["timing"]["total_ms"] = int((time.monotonic() - t0) * 1000)
            return out
        out["timing"]["recognize_ms"] = int((time.monotonic() - t_rec) * 1000)

        track = res.get("track") or None
        if track:
            images = track.get("images") or {}
            # `genres` is a dict like {"primary": "Hip-Hop/Rap"} — flatten to
            # a list so JSON consumers don't have to know that shape.
            genres_raw = track.get("genres") or {}
            genres = (
                list(genres_raw.values())
                if isinstance(genres_raw, dict)
                else (genres_raw if isinstance(genres_raw, list) else None)
            )
            out["matched"] = True
            out["track"] = {
                "title": track.get("title"),
                "artist": track.get("subtitle"),
                "album": _safe_meta(track, "Album"),
                "released": _safe_meta(track, "Released"),
                "label": _safe_meta(track, "Label"),
                "image": images.get("coverarthq") or images.get("coverart"),
                "shazam_id": track.get("key"),
                "isrc": track.get("isrc"),
                "genres": genres,
                "share_url": (track.get("share") or {}).get("href"),
            }

    out["timing"]["total_ms"] = int((time.monotonic() - t0) * 1000)
    return out


def main():
    p = argparse.ArgumentParser(
        description="Sample a radio stream and identify the current track via Shazam.",
    )
    p.add_argument("url", help="Stream URL (HLS / m3u8 / mp3 / aac)")
    p.add_argument(
        "--seconds", type=int, default=5,
        help="Audio sample length in seconds (default 5)",
    )
    p.add_argument(
        "--timeout", type=int, default=20,
        help="Per-step timeout in seconds (default 20)",
    )
    p.add_argument(
        "--no-headers", action="store_true",
        help="Don't send spoofed UA/Referer to the stream",
    )
    args = p.parse_args()

    try:
        result = asyncio.run(capture_and_recognize(
            url=args.url,
            seconds=args.seconds,
            timeout=args.timeout,
            use_headers=not args.no_headers,
        ))
    except KeyboardInterrupt:
        sys.exit(130)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    # Exit non-zero on hard error or no match so the script is shell-friendly.
    if result.get("error"):
        sys.exit(2)
    if not result.get("matched"):
        sys.exit(1)


if __name__ == "__main__":
    main()
