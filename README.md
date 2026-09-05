# DNOStracker

Hourly habit tracker for waking hours. Log a few of your life markers each hour and leave a short report. Tracking pauses automatically during your sleep window.

## Markers

- Health
- Work
- Prep
- Workout
- Social
- Stress management
- Study

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express API (JSON file store in `server/data/`)

## Run locally

```bash
# install
npm run install:all

# terminal 1 — API on http://127.0.0.1:3847
npm run dev:server

# terminal 2 — UI on http://127.0.0.1:4179
npm run dev:client
```

The Vite dev server proxies `/api` to the Express backend.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/clock` | Local date/hour, sleep status, whether this hour needs a check-in |
| GET/PUT | `/api/settings` | Sleep window + timezone offset |
| GET | `/api/markers` | Marker list |
| GET/POST | `/api/entries` | List or save an hourly pulse (blocked in sleep hours) |
| GET | `/api/day-summary` | Averages, missing hours, reports for a day |

Default sleep window: **23:00 → 07:00** (configurable in the UI).
