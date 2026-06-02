"""
Shazam sidecar — FastAPI wrapper around shazamio.

Runs as a separate container next to the Node sunoh-api. Avoids polluting
the Alpine Node image with Python + numpy + native deps, and amortises
the shazamio import cost (~500 ms) over many requests instead of paying
it per Node→Python subprocess spawn.

Single endpoint:
    POST /identify
        body: { "url": "...", "seconds": 5, "use_headers": true }
        response: { matched, track | null, timing, error | null }

The recognise logic is intentionally identical to the standalone CLI
script at `scripts/identify-now-playing.py` — capture N seconds via
ffmpeg, then hand the WAV to shazamio. Keeps the contract simple for
the Node worker that will call this.

Health:
    GET /healthz → { ok: true }
"""

import asyncio
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from shazamio import Shazam

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/91.0.4472.124 Safari/537.36"
)
REFERER = "https://onlineradiobox.com/"

app = FastAPI(title="sunoh-shazam-sidecar", version="1.0.0")

# Instantiate once at import — Shazam() does no I/O in its constructor;
# this saves the cost of creating it on every request.
_shazam = Shazam()


class IdentifyRequest(BaseModel):
    url: str
    seconds: int = Field(default=5, ge=2, le=15)
    timeout: int = Field(default=20, ge=5, le=60)
    use_headers: bool = True


class TrackInfo(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    released: Optional[str] = None
    label: Optional[str] = None
    image: Optional[str] = None
    shazam_id: Optional[str] = None
    isrc: Optional[str] = None
    genres: Optional[list[str]] = None
    share_url: Optional[str] = None


class Timing(BaseModel):
    capture_ms: Optional[int] = None
    recognize_ms: Optional[int] = None
    total_ms: int


class IdentifyResponse(BaseModel):
    matched: bool
    track: Optional[TrackInfo] = None
    timing: Timing
    error: Optional[str] = None


def _safe_meta(track: dict, name: str):
    """Pull a labelled field (Album / Released / Label) out of Shazam's
    nested `track.sections[].metadata[]` shape."""
    sections = track.get("sections") or []
    for s in sections:
        for m in s.get("metadata") or []:
            if m.get("title") == name:
                return m.get("text")
    return None


async def _identify(req: IdentifyRequest) -> IdentifyResponse:
    t0 = time.monotonic()
    capture_ms = None
    recognize_ms = None

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "sample.wav"

        cmd = ["ffmpeg", "-loglevel", "error"]
        if req.use_headers:
            cmd += [
                "-user_agent", UA,
                "-headers", f"Referer: {REFERER}\r\n",
            ]
        cmd += [
            "-t", str(req.seconds),
            "-i", req.url,
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            "-y", str(wav_path),
        ]

        t_cap = time.monotonic()
        try:
            r = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, timeout=req.timeout,
            )
        except subprocess.TimeoutExpired:
            return IdentifyResponse(
                matched=False,
                timing=Timing(total_ms=int((time.monotonic() - t0) * 1000)),
                error=f"ffmpeg timed out after {req.timeout}s",
            )
        capture_ms = int((time.monotonic() - t_cap) * 1000)

        if r.returncode != 0:
            return IdentifyResponse(
                matched=False,
                timing=Timing(capture_ms=capture_ms,
                              total_ms=int((time.monotonic() - t0) * 1000)),
                error="ffmpeg: " + r.stderr.decode("utf-8", errors="ignore")[:300].strip(),
            )
        if not wav_path.exists() or wav_path.stat().st_size < 1024:
            return IdentifyResponse(
                matched=False,
                timing=Timing(capture_ms=capture_ms,
                              total_ms=int((time.monotonic() - t0) * 1000)),
                error="ffmpeg produced an empty / truncated sample",
            )

        t_rec = time.monotonic()
        try:
            res = await asyncio.wait_for(
                _shazam.recognize(str(wav_path)), timeout=req.timeout,
            )
        except asyncio.TimeoutError:
            return IdentifyResponse(
                matched=False,
                timing=Timing(capture_ms=capture_ms,
                              total_ms=int((time.monotonic() - t0) * 1000)),
                error=f"shazam recognize timed out after {req.timeout}s",
            )
        recognize_ms = int((time.monotonic() - t_rec) * 1000)

        track_obj = res.get("track")
        if not track_obj:
            return IdentifyResponse(
                matched=False,
                timing=Timing(
                    capture_ms=capture_ms,
                    recognize_ms=recognize_ms,
                    total_ms=int((time.monotonic() - t0) * 1000),
                ),
            )

        images = track_obj.get("images") or {}
        genres_raw = track_obj.get("genres") or {}
        genres = (
            list(genres_raw.values())
            if isinstance(genres_raw, dict)
            else (genres_raw if isinstance(genres_raw, list) else None)
        )
        track = TrackInfo(
            title=track_obj.get("title"),
            artist=track_obj.get("subtitle"),
            album=_safe_meta(track_obj, "Album"),
            released=_safe_meta(track_obj, "Released"),
            label=_safe_meta(track_obj, "Label"),
            image=images.get("coverarthq") or images.get("coverart"),
            shazam_id=track_obj.get("key"),
            isrc=track_obj.get("isrc"),
            genres=genres,
            share_url=(track_obj.get("share") or {}).get("href"),
        )

        return IdentifyResponse(
            matched=True,
            track=track,
            timing=Timing(
                capture_ms=capture_ms,
                recognize_ms=recognize_ms,
                total_ms=int((time.monotonic() - t0) * 1000),
            ),
        )


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/identify", response_model=IdentifyResponse)
async def identify(req: IdentifyRequest):
    if not req.url:
        raise HTTPException(status_code=400, detail="url required")
    return await _identify(req)
