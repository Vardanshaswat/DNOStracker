# DNOStracker

Hourly habit tracker for waking hours. Log a few life markers each hour and leave a short report. The sleep window is a flexible daily schedule — adjust it anytime, and if you wake early or stay up late you can still track that hour.

## Markers

- Health
- Work
- Prep
- Workout
- Social
- Stress management
- Study

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (`client/`)
- **Backend:** Node.js + Express API (`server/`) with a JSON file store

## Run locally

```bash
git clone https://github.com/Vardanshaswat/DNOStracker.git
cd DNOStracker
npm run install:all
npm run dev
```

- UI: http://127.0.0.1:4179
- API: http://127.0.0.1:3847

Or run separately:

```bash
npm run dev:server
npm run dev:client
```

## Behavior

- Hourly check-ins for any subset of markers (score 1–5) + a short report
- Sleep window is adjustable any time during the day
- Sleep does **not** hard-block tracking — tap **I’m awake** (or just save) to log that hour
- Saving during the sleep window auto-marks the hour as awake for today
