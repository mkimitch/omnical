# OmniCal

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57)](https://www.sqlite.org/)

A TypeScript calendar service that syncs Google Calendar and ICS feeds into a local SQLite database, with on-demand recurrence expansion and multiple export formats.

> ## 👨🏼‍💻 Currently Available for Hire
>
> Hi there! 👋 I'm actively seeking **Senior or Lead** roles as a **Full Stack Engineer** or **Front-end Engineer**.
>
> **OmniCal** showcases my expertise in TypeScript, REST API design, database architecture, OAuth implementation, and building production-ready backend services. I specialize in JavaScript, TypeScript, React, Node.js, and modern web technologies.
>
> Interested in collaborating? Connect with me on [LinkedIn](https://www.linkedin.com/in/mkimitch/) or email [mark.kimitch@gmail.com](mailto:mark.kimitch@gmail.com).

## Features

- **Multi-source sync**: Google Calendar (OAuth2) and ICS feeds (HTTP)
- **Automatic scheduling**: Periodic sync every 5 minutes (configurable)
- **Efficient updates**: Conditional HTTP requests (ETag/Last-Modified) for ICS, incremental sync tokens for Google
- **Recurrence expansion**: On-demand expansion of RRULEs with overrides and exceptions
- **Time zone support**: All times stored in UTC; optional client timezone conversion for queries
- **Multiple export formats**: JSON events, free/busy blocks, merged ICS
- **Per-calendar opt-in filtering & dedupe**: Applied at query/expansion time (does not modify ingested data)
- **Performance**: In-memory LRU cache (30s TTL) for expansion results
- **Health & metrics**: Prometheus-style metrics endpoint

## Prerequisites

- **Node.js**: 20.x LTS (tested on 20.12.2)
- **Yarn**: 1.22.22 (enable via `corepack enable`)
- **SQLite**: Included via better-sqlite3

## Installation

### 1. Enable Yarn (if not already installed)

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

### 2. Clone and install dependencies

```bash
git clone https://github.com/yourusername/omnical.git
cd omnical
yarn install
```

### 3. Configure environment

Create a `.env` file in the project root:

```bash
# Required for basic server
API_KEY=your-secret-key-min-8-chars

# Defaults used if omitted
PORT=8787
BIND_ADDR=127.0.0.1
DB_PATH=./data/cal.db
DATA_DIR=./data
LOG_LEVEL=info
SYNC_INTERVAL_MS=300000
NODE_ENV=development

# Optional: Bootstrap ICS calendars on startup (comma-separated)
ICS_URLS=

# Optional: Override Google OAuth scopes (default shown)
# GOOGLE_SCOPES=https://www.googleapis.com/auth/calendar.readonly

# Required for Google Calendar features (OAuth/device flow & sync)
# Generate a 32-byte base64 key for encrypting tokens
OAUTH_ENCRYPTION_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Generate a secure API key** (min 8 chars):

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

**Generate OAuth encryption key** (32-byte base64, for Google Calendar):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Start the server

**Development** (with hot reload):

```bash
yarn dev
```

**Production**:

```bash
yarn build
yarn start
```

## API Reference

All protected endpoints require the `X-API-Key` header matching the `API_KEY` in `.env`.

### Health & Monitoring (no auth required)

#### `GET /healthz`

```bash
curl http://127.0.0.1:8787/healthz
```

**Response**:

```json
{ "ok": true, "now": 1759243506961, "version": "0.1.0" }
```

#### `GET /metrics`

```bash
curl http://127.0.0.1:8787/metrics
```

**Response** (Prometheus text format):

```text
# HELP up 1 if the service is up
# TYPE up gauge
up 1
# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.
# TYPE process_start_time_seconds gauge
process_start_time_seconds 1758942305
# HELP nodejs_memory_rss_bytes Resident set size in bytes.
# TYPE nodejs_memory_rss_bytes gauge
nodejs_memory_rss_bytes 81080320
```

### Calendar Management

#### `GET /v1/calendars`

List all calendars with metadata (sorted by `sortOrder`, then `id`).

```bash
curl -H "X-API-Key: your-secret-key" http://127.0.0.1:8787/v1/calendars
```

**Response**:

```json
[
	{
		"color": "oklch(0.62 0.19 259.81)",
		"description": "Work calendar",
		"enabled": true,
		"filterJson": null,
		"googleCalId": null,
		"icon": "📅",
		"icsUrl": "http://example.com/feed.ics",
		"id": "ics_2f89f7f05ca3",
		"label": "My ICS Feed",
		"sortOrder": 0,
		"syncToken": null,
		"type": "ics",
		"updatedAt": 1758942606668
	}
]
```

#### `GET /v1/calendars/:id`

Get a single calendar by ID.

```bash
curl -H "X-API-Key: your-secret-key" http://127.0.0.1:8787/v1/calendars/ics_2f89f7f05ca3
```

**Response**: Same as list item above, or `404` if not found.

#### `POST /v1/calendars/ics`

Create a new ICS calendar.

```bash
curl -X POST -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/calendar.ics", "label": "Work Calendar"}' \
  http://127.0.0.1:8787/v1/calendars/ics
```

**Request Body**:

```json
{
	"url": "https://example.com/calendar.ics",
	"label": "Work Calendar" // optional
}
```

**Response**: `201 Created` with the created calendar object.

#### `POST /v1/calendars/google`

Create a new Google Calendar.

```bash
curl -X POST -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"calendarId": "your_calendar_id@group.calendar.google.com", "label": "My Google Cal"}' \
  http://127.0.0.1:8787/v1/calendars/google
```

**Request Body**:

```json
{
	"calendarId": "your_calendar_id@group.calendar.google.com",
	"label": "My Google Calendar" // optional
}
```

**Response**: `201 Created` with the created calendar object.

**Note**: You must run `yarn auth:google` first to authenticate with Google Calendar API.

#### `PUT /v1/calendars/:id`

Update calendar metadata (label, color, icon, description, sort order, enabled status) and optional per-calendar event filtering and deduplication.

```bash
curl -X PUT -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"label": "Updated Label", "color": "oklch(0.64 0.21 25.33)", "icon": "🎉", "sortOrder": 10, "enabled": true, "filterJson": {"enabled": true, "allDay": {"excludeKeywords": ["PTO", "OOO", "Out of Office"], "allowKeywords": ["Smruti"]}, "dedupe": {"enabled": true, "acrossCalendars": true, "group": "work-mirrors"}}}' \
  http://127.0.0.1:8787/v1/calendars/ics_2f89f7f05ca3
```

**Request Body** (all fields optional):

```json
{
	"color": "oklch(0.64 0.21 25.33)",
	"description": "My personal calendar",
	"enabled": false,
	"filterJson": null,
	"icon": "🎉",
	"label": "Updated Label",
	"sortOrder": 10
}
```

**Customization fields**:

- **`label`**: Display name (string or null)
- **`color`**: Hex color code for UI theming (e.g., `oklch(0.62 0.19 259.81)`) or null
- **`icon`**: Emoji or icon identifier (e.g., `📅`, `🎉`) or null
- **`description`**: Longer description text or null
- **`sortOrder`**: Integer for display ordering (lower = earlier); calendars are sorted by this field, then by ID
- **`enabled`**: Boolean to enable/disable sync and event queries
- **`filterJson`**: Optional per-calendar query-time rules configuration (filters and dedupe).
  - If omitted: no change
  - If `null`: clears rules
  - If a string: stored as-is (must contain valid JSON)
  - If an object: stored as JSON and applied at query/expansion time
  - Calendar responses return `filterJson` as the stored JSON string (or `null`).
  - Rules are opt-in and do not modify ingested data; they only affect outputs from `GET /v1/events`, `GET /v1/freebusy`, and `GET /v1/ics`.
  - Note: calendar `enabled` controls whether the calendar itself is active; `filterJson.enabled` controls whether filtering is active; `filterJson.dedupe.enabled` controls whether deduplication is active.
  - Cross-calendar dedupe requires `filterJson.dedupe.acrossCalendars: true` and is only applied by `GET /v1/events` and `GET /v1/ics`. Set `filterJson.dedupe.group` to limit dedupe to calendars sharing the same group.

**Filter config format** (example):

```json
{
	"enabled": true,
	"allDay": {
		"excludeKeywords": ["PTO", "OOO", "Out of Office"],
		"allowKeywords": ["Smruti"]
	}
}
```

**Filter semantics**:

- **All-day events only**: the example above only applies to `allDay: true` events.
- **Exclude**: if an all-day event contains any `excludeKeywords`, it is filtered out.
- **Allow/exception**: if it contains any `allowKeywords`, it is kept even if it matches an exclude keyword.

**Dedupe config format** (example):

```json
{
	"dedupe": {
		"enabled": true,
		"acrossCalendars": true,
		"group": "work-mirrors",
		"caseInsensitiveSummary": true,
		"requireNonEmptySummary": true
	}
}
```

**Dedupe semantics**:

- **Key**: Events are considered duplicates when `summary`, `allDay`, `start`, and `end` match (after normalization).
- **Summary normalization**: By default, `summary` is trimmed and lowercased (`caseInsensitiveSummary: true`).
- **Empty summaries**: By default, events with empty `summary` are not deduped (`requireNonEmptySummary: true`).
- **Winner selection**: When duplicates exist, the calendar with the lower `sortOrder` wins; ties prefer the richer event payload.
- **Scope**: By default, dedupe is within a single calendar. If `acrossCalendars: true`, dedupe can span calendars.
  - If `group` is set: only calendars with the same group are deduped together.
  - If `group` is omitted: all calendars with `acrossCalendars: true` are considered part of one group.

#### `DELETE /v1/calendars/:id`

Delete a calendar and all its events.

```bash
curl -X DELETE -H "X-API-Key: your-secret-key" \
  http://127.0.0.1:8787/v1/calendars/ics_2f89f7f05ca3
```

**Response**:

```json
{ "ok": true, "message": "Calendar deleted" }
```

Or `404` if calendar not found.

**Warning**: This permanently deletes the calendar and all associated events from the local database. It does not affect the remote calendar source.

#### `POST /v1/sync`

Trigger a manual sync for all enabled calendars.

```bash
curl -X POST -H "X-API-Key: your-secret-key" http://127.0.0.1:8787/v1/sync
```

**Response**:

```json
{
	"google": { "updated": 0, "calendars": [] },
	"ics": { "updated": 34, "calendars": ["ics_2f89f7f05ca3"] }
}
```

### Event Queries

#### `GET /v1/events`

Query events within a time window (UTC). Recurrences are expanded on-demand.

Note: Per-calendar `filterJson` rules (filters and dedupe) are applied at query/expansion time (they do not modify ingested data). Cross-calendar dedupe is enabled on this endpoint when calendars opt in via `filterJson.dedupe.acrossCalendars`.

**Query Parameters**:

- `start` (required): ISO 8601 UTC timestamp (e.g., `2025-09-01T00:00:00Z`)
- `end` (required): ISO 8601 UTC timestamp
- `includeCancelled` (optional): `true` to include cancelled events (default: `false`)
- `clientZone` (optional): IANA timezone (e.g., `America/Chicago`) to convert times to local

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://127.0.0.1:8787/v1/events?start=2025-09-01T00:00:00Z&end=2025-10-01T00:00:00Z"
```

**With local timezone**:

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://127.0.0.1:8787/v1/events?start=2025-09-01T00:00:00Z&end=2025-10-01T00:00:00Z&clientZone=America/Chicago"
```

**Response** (UTC):

```json
[
	{
		"allDay": false,
		"calendarId": "ics_2f89f7f05ca3",
		"description": "Weekly sync",
		"end": "2025-09-17T02:30:00.000Z",
		"location": "Conference Room A",
		"recurrence": { "isRecurring": false },
		"source": { "type": "ics", "id": "event123@example.com" },
		"start": "2025-09-16T23:30:00.000Z",
		"status": "CONFIRMED",
		"summary": "Team Meeting",
		"uid": "event123@example.com"
	}
]
```

#### `GET /v1/freebusy`

Get busy blocks per calendar and a merged view.

Note: Free/busy blocks are derived from expanded events, so per-calendar `filterJson` rules (filters and per-calendar dedupe) apply here too. Cross-calendar dedupe is not applied on this endpoint.

**Query Parameters**:

- `start` (required): ISO 8601 UTC timestamp
- `end` (required): ISO 8601 UTC timestamp

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://127.0.0.1:8787/v1/freebusy?start=2025-09-01T00:00:00Z&end=2025-10-01T00:00:00Z"
```

**Response**:

```json
{
	"calendars": {
		"ics_2f89f7f05ca3": [
			{ "start": "2025-09-16T23:30:00.000Z", "end": "2025-09-17T02:30:00.000Z" },
			{ "start": "2025-09-19T23:30:00.000Z", "end": "2025-09-20T02:30:00.000Z" }
		]
	},
	"merged": [
		{ "start": "2025-09-16T23:30:00.000Z", "end": "2025-09-17T02:30:00.000Z" },
		{ "start": "2025-09-19T23:30:00.000Z", "end": "2025-09-20T02:30:00.000Z" }
	]
}
```

Note: Free/busy response times are returned in UTC.

#### `GET /v1/ics`

Export events as a merged ICS file (text/calendar).

Note: Per-calendar `filterJson` rules (filters and dedupe) are applied before exporting. Cross-calendar dedupe is enabled on this endpoint when calendars opt in via `filterJson.dedupe.acrossCalendars`.

**Query Parameters**:

- `start` (optional): ISO 8601 UTC timestamp (default: now)
- `end` (optional): ISO 8601 UTC timestamp (default: 30 days from now)

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://127.0.0.1:8787/v1/ics?start=2025-09-01T00:00:00Z&end=2025-10-01T00:00:00Z" \
  -o merged.ics
```

## ICS Calendar Setup

### Add an ICS feed

Use the CLI tool to register an ICS calendar:

```bash
yarn add:ics "https://example.com/calendar.ics" "My Calendar"
```

This registers the feed and enables it for sync.

### Bootstrap from environment

Add ICS URLs to `.env` (comma-separated) to auto-register on startup:

```bash
ICS_URLS=https://example.com/work.ics,https://example.com/team.ics
```

Then restart the server:

```bash
yarn dev
```

### Trigger a sync

Manual sync:

```bash
curl -X POST -H "X-API-Key: your-secret-key" http://127.0.0.1:8787/v1/sync
```

The scheduler will also auto-sync every 5 minutes (configurable via `SYNC_INTERVAL_MS`).

## Google Calendar Setup

### 1. Create OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Google Calendar API**
4. Create **OAuth 2.0 Client ID** credentials:
   - Application type: **Desktop app** or **Web application**
   - Note the **Client ID** and **Client Secret**

### 2. Configure environment

Add to `.env`:

```bash
OAUTH_ENCRYPTION_KEY=<32-byte-base64-from-earlier>
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
```

### 3. Run OAuth device flow

```bash
yarn auth:google
```

Follow the printed instructions:

1. Open the verification URL in a browser
2. Enter the user code
3. Approve access to Google Calendar
4. The refresh token will be stored encrypted in SQLite

### 4. Add a Google Calendar

```bash
yarn add:gcal "your_calendar_id@group.calendar.google.com" "My Google Cal"
```

To find your calendar ID:

- Open Google Calendar settings
- Click on the calendar name
- Scroll to "Integrate calendar" → **Calendar ID**

### 5. Sync and verify

```bash
curl -X POST -H "X-API-Key: your-secret-key" http://127.0.0.1:8787/v1/sync
```

Check events:

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://127.0.0.1:8787/v1/events?start=2025-01-01T00:00:00Z&end=2025-12-31T23:59:59Z"
```

## Development

### Available Commands

- **`yarn dev`**: Start dev server with hot reload (tsx watch)
- **`yarn build`**: Compile TypeScript to `dist/`
- **`yarn start`**: Run compiled production build
- **`yarn lint`**: Run ESLint
- **`yarn format`**: Format code with Prettier
- **`yarn test`**: Run Vitest tests
- **`yarn test:watch`**: Run tests in watch mode
- **`yarn auth:google`**: OAuth device flow for Google Calendar
- **`yarn add:gcal`**: Register a Google Calendar ID
- **`yarn add:ics`**: Register an ICS feed URL

### Project Structure

```text
omnical/
├── src/
│   ├── index.ts              # Server entry point
│   ├── config/
│   │   └── env.ts            # Zod-validated environment config
│   ├── db/
│   │   ├── conn.ts           # SQLite connection singleton
│   │   ├── index.ts          # Migration runner
│   │   ├── repo.ts           # Calendar and event queries
│   │   ├── schema.ts         # Drizzle schema
│   │   └── tokens.ts         # OAuth token encryption/decryption
│   ├── sync/
│   │   ├── orchestrator.ts   # Sync coordinator
│   │   ├── google.ts         # Google Calendar sync
│   │   └── ics.ts            # ICS feed sync
│   ├── expansion/
│   │   └── expand.ts         # Recurrence expansion engine
│   ├── routes/
│   │   ├── health.ts         # /healthz
│   │   ├── metrics.ts        # /metrics
│   │   ├── calendars.ts      # GET /v1/calendars
│   │   ├── events.ts         # GET /v1/events, /v1/freebusy
│   │   ├── ics.ts            # GET /v1/ics
│   │   └── sync.ts           # POST /v1/sync
│   ├── server/
│   │   └── auth.ts           # API key auth middleware
│   ├── google/
│   │   └── oauth.ts          # Token refresh logic
│   ├── crypto/
│   │   └── aes.ts            # AES-256-GCM encryption
│   ├── logging/
│   │   └── logger.ts         # Pino logger
│   ├── util/
│   │   ├── hash.ts           # SHA-1 utility
│   │   └── lru.ts            # LRU cache
│   └── cli/
│       ├── authGoogleDevice.ts   # OAuth CLI
│       ├── addGoogleCal.ts       # Register Google calendar
│       └── addIcsCal.ts          # Register ICS feed
├── drizzle/
│   └── migrations/
│       ├── 000_init.sql                  # Initial schema
│       ├── 001_add_calendar_metadata.sql  # Calendar metadata columns
│       └── 002_add_calendar_filters.sql   # Per-calendar filter settings
├── data/
│   └── cal.db                # SQLite database (created on first run)
├── package.json
├── tsconfig.json
├── .env                      # Your environment config (not in git)
└── README.md
```

### Database Schema

- **`calendars`**: Calendar sources (Google or ICS) and per-calendar settings
- **`raw_events`**: Normalized event storage (masters, overrides, singles)
- **`oauth_tokens`**: Encrypted OAuth refresh/access tokens

### Notes

- **Migrations**: On startup, SQL migrations in `drizzle/migrations` are applied idempotently and tracked in `_migrations`.
- **Recurrence expansion**: Events with RRULEs are expanded on-demand during queries. A 30-second in-memory LRU cache speeds up repeated queries.
- **Time zones**: All times are stored and queried in UTC. Use the `clientZone` parameter to convert results to a local timezone.

## Deployment

### Docker (example)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile
COPY . .
RUN yarn build
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t omnical .
docker run -p 8787:8787 --env-file .env -v ./data:/app/data omnical
```

### Systemd Service (Linux)

Create `/etc/systemd/system/omnical.service`:

```ini
[Unit]
Description=OmniCal Calendar API
After=network.target

[Service]
Type=simple
User=calendar
WorkingDirectory=/opt/omnical
EnvironmentFile=/opt/omnical/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable omnical
sudo systemctl start omnical
sudo systemctl status omnical
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
