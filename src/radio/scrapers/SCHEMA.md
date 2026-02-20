# Radio Station Schema Standard

All radio scrapers in this project MUST output data in the following standardized JSON format. This ensures that the ingestion and sync tools can process data from any provider without special handling.

## JSON Format

```json
{
  "id": "provider_internalid",
  "name": "Station Name",
  "image": "https://example.com/logo.png",
  "stream_url": "https://stream.example.com/live.mp3",
  "website": "https://official-station-site.com",
  "provider": "onlineradiobox",
  "country": "United States",
  "genres": ["Jazz", "Ambient"],
  "languages": ["English"],
  "description": "Short bio or slogan of the station.",
  "status": "working",
  "codec": "mp3",
  "bitrate": "128000",
  "sample_rate": "44100",
  "last_tested_at": "2024-02-20T12:00:00Z"
}
```

## Field Definitions

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | **Mandatory**. Format: `provider_internalId`. Example: `onlineradiobox_428238`. |
| `name` | `string` | **Mandatory**. The display name of the station. |
| `image` | `string` | **Mandatory**. Absolute URL to the square logo of the station. Use empty string if unavailable. |
| `stream_url` | `string` | **Mandatory**. The final, direct, playable audio stream URL. |
| `website` | `string` | **Recommended**. The official website of the radio station (original source). |
| `provider` | `string` | **Mandatory**. Lowercase name of the scraper source (e.g., `mytuner`, `onlineradiobox`). |
| `country` | `string` | **Mandatory**. Normalized English name of the country. |
| `genres` | `string[]` | **Mandatory**. List of tags/genres. Use empty array `[]` if none. |
| `languages` | `string[]` | **Mandatory**. List of languages spoken on the station. Use empty array `[]` if none. |
| `description` | `string` | **Recommended**. Text description of the station content. |
| `status` | `string` | **Mandatory**. One of: `working`, `broken`, `untested`. |
| `codec` | `string` | **Mandatory**. Audio format identifier: `mp3`, `aac`, `hls`, etc. Use `unknown` if unknown. |
| `bitrate` | `string` | **Optional**. The bitrate in bits per second (e.g., "128000"). |
| `sample_rate` | `string` | **Optional**. The sample rate in Hz (e.g., "44100"). |
| `last_tested_at` | `string` | **Mandatory**. ISO 8601 UTC timestamp of the last stream validation. |

---

## Implementation Checklist

1. [ ] Use plural `languages` (string array), NOT `language` (single string).
2. [ ] Prefix the `id` with the provider name + underscore.
3. [ ] Ensure `last_tested_at` is in UTC ISO format (`YYYY-MM-DDTHH:MM:SSZ`).
4. [ ] If multiple streams exist, have the scraper test them and only set `stream_url` to the highest-quality **working** one.
