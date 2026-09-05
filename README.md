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
- **Auth:** Username + password accounts, httpOnly session cookie

## Run locally

```bash
git clone https://github.com/Vardanshaswat/DNOStracker.git
cd DNOStracker
cp .env.example .env
npm run install:all
```

Set `JWT_SECRET` in `.env` to a long random string (`openssl rand -base64 32`), then:

```bash
npm run dev
```

- UI: http://127.0.0.1:4179
- API: http://127.0.0.1:3847

Open the UI, **create an account** (username + password), then sign in with those credentials.

Or run separately:

```bash
npm run dev:server
npm run dev:client
```

## Behavior

- Sign up / sign in with a username and password — hourly entries and sleep settings are stored per account
- Hourly check-ins for any subset of markers (score 1–5) + a short report
- Sleep window is adjustable any time during the day
- Sleep does **not** hard-block tracking — tap **I’m awake** (or just save) to log that hour
- Saving during the sleep window auto-marks the hour as awake for today

## Host live (safe path)

One HTTPS origin: Express serves the API **and** the built React app. Accounts live on a **persistent volume**, not the container disk (that is wiped on every deploy).

### Railway

1. Push this repo to GitHub.
2. [New project](https://railway.app/new) → Deploy from GitHub repo.
3. Variables:
   - `JWT_SECRET` — `openssl rand -base64 32` (do not reuse a secret you have pasted into chat)
   - `NODE_ENV=production`
   - `DATA_DIR=/data`
4. Volume: New volume → mount path `/data`.
5. Generate a public domain on the service.

Open that `https://….up.railway.app` URL, create an account, and use the app. Login cookies stay on that origin; the JSON store stays on the volume.

Do **not** split the UI onto Vercel and the API onto Railway — session cookies will break unless you add extra CORS/cookie work. The Docker image is the supported production path.
