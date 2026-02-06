# Sunoh API 🎵

[![Version](https://img.shields.io/badge/version-1.0.3-blue.svg)](api-endpoints.json)
[![Tech Stack](https://img.shields.io/badge/tech-Fastify%20%7C%20TypeScript%20%7C%20Redis-007acc.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

The high-performance core for the [Sunoh Music App](https://www.sunoh.online), delivering a unified music discovery experience by orchestrating data from multiple industry-leading providers.

---

## 🚀 Overview

Sunoh API is a modern, TypeScript-based middleware designed to bridge the gap between various music sources. It provides a homogeneous data structure, allowing client applications to interact with many providers through a single, consistent interface.

### **Key Features**
- 🌪️ **Unified Search & Home**: Intelligent result merging and interleaving from Saavn and Gaana.
- ⚡ **Multi-Tier Caching**: Robust Redis-backed caching system with granular TTL policies.
- 🎼 **Provider-Agnostic Interface**: One API for Songs, Albums, Playlists, and Artists regardless of the source.
- 🎤 **LRC/Synced Lyrics**: High-quality sync lyrics integration via specialized providers.
- 🟢 **Gaana Integration Plus**: Native support for stream decryption, curated occasions, and radio stations.
- 🐋 **Docker Ready**: Fully containerized environment for seamless deployment and development.

---

## 🛠️ Technology Stack

- **Runtime**: Node.js (v20+)
- **Framework**: [Fastify](https://www.fastify.io/) (High performance, low overhead)
- **Language**: TypeScript (Type-safe codebase)
- **Database/Cache**: Redis (High-speed data persistence)
- **Containerization**: Docker & Docker Compose
- **Deployment**: Optimized for Vercel Serverless and Standalone Docker.

---

## 🏛️ Architecture

### **Unified Search Engine**
The API implements a sophisticated merging algorithm that prioritizes data quality and relevancy. When a search is performed:
1. It queries multiple providers (Saavn, Gaana) in parallel using `Promise.allSettled`.
2. It deduplicates results based on internal IDs and normalized titles.
3. It cleans "dirty" metadata (e.g., placeholder titles like "Untitled" or "None").
4. It prioritizes the highest resolution imagery available (`atw` format).

### **Data Homogenization**
All source data is mapped to a strictly typed internal schema before returning. This means your frontend doesn't need to know if a song came from Saavn or Gaana; it always receives the exact same JSON structure.

---

## 🚦 Getting Started

### **Environment Setup**
Create a `.env` file in the root directory:
```env
PORT=3600
REDIS_HOST=redis
REDIS_PORT=6379
# PROVIDER TOKENS
LYRICS_TOKEN=your_token
MEDIA_USER_TOKEN=your_token
```

### **1. Using Docker (Recommended)**
The fastest way to get up and running:
```bash
# Start API and Redis containers
npm run docker:up -- --build
```
The API will be available at `http://localhost:3600`.

### **2. Local Development**
```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev
```

---

## 📖 API Documentation

Detailed endpoint specifications can be found in [api-endpoints.json](api-endpoints.json).

### **Core Endpoints**
| Path | Method | Description |
| :--- | :--- | :--- |
| `/music/home` | `GET` | Unified home screen with interleaved charts and releases. |
| `/music/search` | `GET` | Merged search results for songs, albums, and playlists. |
| `/music/song/:id` | `GET` | Full song metadata and streaming URLs. |
| `/music/occasions`| `GET` | Browse curated moods and genres (Gaana focused). |
| `/lyrics/:name` | `GET` | Get LRC/Synced lyrics for a specific track. |

---

## 💾 Caching Policy

We employ a tiered caching strategy to ensure minimal latency:
- **Playlists & Albums**: 2 Hours (Tailored for discoverability).
- **Home & Occasions**: 3 Hours (Optimized for performance).
- **Fast-Changing Data**: No cache (e.g., real-time streams).

---

## 🚢 Deployment

### **Docker Deployment**
```bash
# Production build and run
docker compose up -d --build
```

### **Vercel Serverless**
The API is pre-configured for Vercel. 
```bash
npm run deploy:prod
```

---

## 🤝 Contributing & Support

This project is the backbone of the Sunoh ecosystem. While we welcome community contributions, our priority is maintaining stability for the Sunoh Music App.

- **Found a bug?** Open a GitHub issue.
- **Want to add a provider?** Please open a discussion first to align on data mapping.
- **Support Sunoh**: Visit [www.sunoh.online](https://www.sunoh.online).

---

**Built with ❤️ by the Sunoh Team** 🎵
