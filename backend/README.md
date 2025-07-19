# Rhythm Backend

This is the backend for the Rhythm music app. It provides APIs for music search, streaming, playlists, authentication, and more.

## Features
- YouTube search, streaming, and download
- Last.fm artist, genre, and playlist integration
- User authentication (JWT)
- User playlists and liked songs
- Admin panel for user/playlist management
- SQLite database

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   # Edit .env and add your keys
   ```
3. Start the server:
   ```bash
   npm start
   ```

## Environment Variables
- `YOUTUBE_API_KEY` (YouTube Data API v3 key)
- `LASTFM_API_KEY` (Last.fm API key)
- `JWT_SECRET` (any random string)

## Deployment
- Deploy to Render, Railway, or any Node.js host.
- Set environment variables in your host's dashboard.

## API Endpoints
- `/search`, `/stream`, `/download`, `/download-video`, `/trending`, `/radio`, `/artists`, `/genre-tracks`, `/playlist-tracks`, `/playlists`, `/liked`, `/admin/*`, etc.

---

For full-stack deployment, deploy the frontend separately (e.g., on Vercel) and update API URLs accordingly. 