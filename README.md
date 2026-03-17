# GeoGuessr Mini

A browser-based GeoGuessr clone. Drop into a random Google Street View anywhere in the world, place your guess on the map, and score points based on how close you are. 5 rounds, up to 25,000 points.

## Features

- **3 region modes** — World, Curated (Europe/NA heavy), Urban (city centers)
- **Timer modes** — Unlimited, 30s, 1min, 2min per round
- **No Move mode** — locked panorama, no walking allowed
- **Streak multiplier** — score 4000+ consecutively for 1.1×/1.25×/1.5× bonus
- **Seed-based games** — share a `?seed=abc123` URL so friends play the same locations
- **Keyboard shortcuts** — `Space` toggle map, `Enter` guess, `→` next round, `Esc` exit
- **Leaderboard** — Google OAuth via Supabase, filter by mode/difficulty
- **Share card** — copyable emoji result with seed for replay

## Setup

```bash
cp .env.example .env
# fill in GOOGLE_MAPS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
npm run dev
# open http://localhost:3000
```

Needs a [Google Maps JS API key](https://console.cloud.google.com) with Street View, Maps JS, and Geometry enabled. Supabase is optional (disables leaderboard/auth if absent).

## Deploy

Push to GitHub and connect to [Vercel](https://vercel.com). Set the three env vars in the Vercel dashboard — done.

## Stack

Vanilla JS + CSS · Google Maps JS API · Supabase (Postgres + Auth) · Node.js dev server · Vercel
