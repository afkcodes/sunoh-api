# Sunoh API 🎵

## About

This backend API is specifically built for **Sunoh Music App**, available at [www.sunoh.online](https://www.sunoh.online).

Sunoh is a music streaming platform that provides access to songs from multiple music sources with comprehensive search and streaming capabilities.

> **Note**: This repository is tailored for Sunoh's specific requirements. While the code is open source, major modifications or feature requests will only be considered if they align with Sunoh Music's roadmap and needs.

## Features

- 🎼 **Multi-source Music API**: Integration with various music streaming services
- 🎤 **Lyrics Support**: Comprehensive lyrics search and fetch capabilities
- 🔴 **Live Music**: WebSocket support for real-time music streaming
- 🖼️ **Image Proxy**: Optimized image serving
- ⚡ **Fast Performance**: Built with Fastify for high performance
- 🚀 **Serverless Ready**: Optimized for Vercel deployment

## API Endpoints

### Music Services

- `/music/*` - Music streaming API endpoints
- `/lyrics/*` - Lyrics search and retrieval

### Core Features

- `/play` - Music playback endpoints
- `/proxy` - Image proxy service
- `/live/*` - WebSocket live music features

## Installation & Setup

### Prerequisites

- Node.js >= 18.12
- npm or yarn package manager

### Environment Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/afkcodes/sunoh-api.git
   cd sunoh-api
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Configuration**

   Create environment files for different stages:

   ```bash
   # Development environment
   cp .env.development.example .env.development

   # Production environment
   cp .env.production.example .env.production
   ```

   Configure the following environment variables:

   ```env
   # Music Service Integration
   LYRICS_TOKEN=your_music_service_bearer_token
   MEDIA_USER_TOKEN=your_music_service_media_user_token

   # Optional: Redis/Valkey for caching
   VALKEY_URL=redis://localhost:6379
   ```

### Development

```bash
# Run development server with auto-reload
npm run dev

# Run with Vercel CLI for serverless testing
npm run start:vercel
```

The API will be available at `http://localhost:3000`

### Production Build

```bash
# Build for production
npm run build:release

# Start production server
npm start
```

### Deployment

#### Vercel (Recommended)

```bash
# Deploy to development/staging
npm run deploy:dev

# Deploy to production
npm run deploy:prod
```

## Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format

# Clean build artifacts
npm run clean
```

## API Usage Examples

### Search and Get Lyrics

```bash
# Search for a song and get lyrics
GET /lyrics/Shape%20of%20You

# With optional parameters
GET /lyrics/Despacito?storefront=us&format=lrc&language=en-IN
```

### Music Search

```bash
GET /music/search?query=Popular%20hits
```

### Get Song Details

```bash
GET /music/song/songId
```

## Tech Stack

- **Framework**: Fastify
- **Language**: TypeScript
- **Deployment**: Vercel Serverless
- **Code Quality**: Biome (linting & formatting)
- **Process Management**: Nodemon (development)

## Contributing

This project is primarily maintained for Sunoh Music App. If you have suggestions or improvements that would benefit Sunoh Music specifically, please:

1. Open an issue describing the enhancement
2. Ensure it aligns with Sunoh's music goals
3. Submit a pull request with clear documentation

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Support

For Sunoh Music App related queries, visit [www.sunoh.online](https://www.sunoh.online)

For technical issues with this API, please open a GitHub issue.

---

**Built with ❤️ for Sunoh Music** 🎵
