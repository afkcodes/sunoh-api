# Python sidecar for Shazam recognition (shazamio + ffmpeg). Runs next
# to the Node sunoh-api container; called over HTTP on the internal
# Docker network (service name `shazam`, port 8080).
#
# Why Debian-slim instead of Alpine: shazamio depends on shazamio-core
# (Rust + audio decoding) which ships glibc-only wheels. Alpine + musl
# would mean building shazamio-core + numpy + pydantic-core from source.
# Not worth the operational pain to save ~50 MB.

FROM python:3.12-slim

# ffmpeg for stream capture, plus the few libs shazamio-core links
# against (lib*.so for audio decoding bits).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       ca-certificates \
       dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so layer cache survives app.py edits.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Internal-only port — exposed to sibling containers via the compose
# `default` network, not published to the host.
EXPOSE 8080

# dumb-init reaps any zombie ffmpeg processes if the worker bails
# mid-capture (subprocess.run with timeout normally cleans up, but
# defence in depth).
ENTRYPOINT ["dumb-init", "--"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
