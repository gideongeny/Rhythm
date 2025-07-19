// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 4000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Initialize SQLite DB
const db = new sqlite3.Database('users.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    UNIQUE(user_id, name)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER,
    title TEXT,
    artist TEXT,
    image TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS liked (
    user_id INTEGER,
    title TEXT,
    artist TEXT,
    image TEXT,
    UNIQUE(user_id, title, artist)
  )`);
});

app.use(cors());

// --- Auth Middleware ---
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// --- User Auth Endpoints ---
app.post('/register', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], function(err) {
    if (err) return res.status(400).json({ error: 'Username already exists' });
    res.json({ success: true });
  });
});
app.post('/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  });
});

// --- Music/YouTube/Last.fm Endpoints ---
app.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}`;
    const ytRes = await axios.get(url);
    const items = ytRes.data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium.url,
      channel: item.snippet.channelTitle
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'YouTube API error', details: err.message });
  }
});
app.get('/stream', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing video id' });
  const url = `https://www.youtube.com/watch?v=${id}`;
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url]);
  res.setHeader('Content-Type', 'audio/mpeg');
  ytdlp.stdout.pipe(res);
  ytdlp.stderr.on('data', data => console.error(data.toString()));
  ytdlp.on('error', err => res.status(500).end('yt-dlp error'));
});
app.get('/download', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing video id' });
  const url = `https://www.youtube.com/watch?v=${id}`;
  res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
  res.setHeader('Content-Type', 'audio/mpeg');
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '-o', '-', url]);
  ytdlp.stdout.pipe(res);
  ytdlp.stderr.on('data', data => console.error(data.toString()));
  ytdlp.on('error', err => res.status(500).end('yt-dlp error'));
});
app.get('/download-video', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing video id' });
  const url = `https://www.youtube.com/watch?v=${id}`;
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
  res.setHeader('Content-Type', 'video/mp4');
  const ytdlp = spawn('yt-dlp', ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4', '-o', '-', url]);
  ytdlp.stdout.pipe(res);
  ytdlp.stderr.on('data', data => console.error(data.toString()));
  ytdlp.on('error', err => res.status(500).end('yt-dlp error'));
});
app.get('/trending', async (req, res) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=US&videoCategoryId=10&maxResults=15&key=${YOUTUBE_API_KEY}`;
    const ytRes = await axios.get(url);
    const items = ytRes.data.items.map(item => ({
      id: item.id,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium.url,
      channel: item.snippet.channelTitle
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'YouTube API error', details: err.message });
  }
});
// Radio stations endpoint
app.get('/radio', async (req, res) => {
  try {
    const country = req.query.country || '';
    let url = 'https://de1.api.radio-browser.info/json/stations?hidebroken=true&limit=30';
    if (country) {
      url += `&country=${encodeURIComponent(country)}`;
    }
    const radioRes = await axios.get(url);
    const stations = radioRes.data.map(station => ({
      name: station.name,
      country: station.country,
      favicon: station.favicon,
      url: station.url_resolved
    }));
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: 'Radio API error', details: err.message });
  }
});
// Artists endpoint (Last.fm API)
app.get('/artists', async (req, res) => {
  try {
    const country = req.query.country || 'Kenya';
    const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
    if (!LASTFM_API_KEY) return res.status(500).json({ error: 'Missing Last.fm API key' });
    const url = `http://ws.audioscrobbler.com/2.0/?method=geo.gettopartists&country=${encodeURIComponent(country)}&api_key=${LASTFM_API_KEY}&format=json&limit=20`;
    const lastfmRes = await axios.get(url);
    const artists = (lastfmRes.data.topartists.artist || []).map(artist => ({
      name: artist.name,
      image: (artist.image && artist.image.length > 2) ? artist.image[2]['#text'] : '',
      url: artist.url
    }));
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: 'Last.fm API error', details: err.message });
  }
});
// Genre tracks endpoint (Last.fm API)
app.get('/genre-tracks', async (req, res) => {
  try {
    const genre = req.query.genre;
    const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
    if (!LASTFM_API_KEY) return res.status(500).json({ error: 'Missing Last.fm API key' });
    if (!genre) return res.status(400).json({ error: 'Missing genre' });
    const url = `http://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(genre)}&api_key=${LASTFM_API_KEY}&format=json&limit=12`;
    const lastfmRes = await axios.get(url);
    const tracks = (lastfmRes.data.tracks.track || []).map(track => ({
      title: track.name,
      artist: track.artist.name,
      image: (track.image && track.image.length > 2) ? track.image[2]['#text'] : '',
    }));
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: 'Last.fm API error', details: err.message });
  }
});
// Playlist tracks endpoint (Last.fm API, using tag as playlist)
app.get('/playlist-tracks', async (req, res) => {
  try {
    const playlist = req.query.playlist;
    const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
    if (!LASTFM_API_KEY) return res.status(500).json({ error: 'Missing Last.fm API key' });
    if (!playlist) return res.status(400).json({ error: 'Missing playlist' });
    const url = `http://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(playlist)}&api_key=${LASTFM_API_KEY}&format=json&limit=12`;
    const lastfmRes = await axios.get(url);
    const tracks = (lastfmRes.data.tracks.track || []).map(track => ({
      title: track.name,
      artist: track.artist.name,
      image: (track.image && track.image.length > 2) ? track.image[2]['#text'] : '',
    }));
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: 'Last.fm API error', details: err.message });
  }
});

// --- User Playlists and Favorites ---
// Get all playlists for user
app.get('/playlists', auth, (req, res) => {
  db.all('SELECT * FROM playlists WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});
// Create playlist
app.post('/playlists', auth, express.json(), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT INTO playlists (user_id, name) VALUES (?, ?)', [req.user.id, name], function(err) {
    if (err) return res.status(400).json({ error: 'Playlist exists' });
    res.json({ id: this.lastID, name });
  });
});
// Delete playlist
app.delete('/playlists/:id', auth, (req, res) => {
  db.run('DELETE FROM playlists WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [req.params.id]);
    res.json({ success: true });
  });
});
// Add track to playlist
app.post('/playlists/:id/tracks', auth, express.json(), (req, res) => {
  const { title, artist, image } = req.body;
  db.run('INSERT INTO playlist_tracks (playlist_id, title, artist, image) VALUES (?, ?, ?, ?)', [req.params.id, title, artist, image], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ success: true });
  });
});
// Remove track from playlist
app.delete('/playlists/:id/tracks', auth, express.json(), (req, res) => {
  const { title, artist } = req.body;
  db.run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND title = ? AND artist = ?', [req.params.id, title, artist], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ success: true });
  });
});
// Get tracks in playlist
app.get('/playlists/:id/tracks', auth, (req, res) => {
  db.all('SELECT * FROM playlist_tracks WHERE playlist_id = ?', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});
// Liked songs endpoints
app.get('/liked', auth, (req, res) => {
  db.all('SELECT * FROM liked WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});
app.post('/liked', auth, express.json(), (req, res) => {
  const { title, artist, image } = req.body;
  db.run('INSERT OR IGNORE INTO liked (user_id, title, artist, image) VALUES (?, ?, ?, ?)', [req.user.id, title, artist, image], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ success: true });
  });
});
app.delete('/liked', auth, express.json(), (req, res) => {
  const { title, artist } = req.body;
  db.run('DELETE FROM liked WHERE user_id = ? AND title = ? AND artist = ?', [req.user.id, title, artist], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ success: true });
  });
});

// --- Admin Endpoints ---
function requireAdmin(req, res, next) {
  if (req.user && req.user.username === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}
app.get('/admin/users', auth, requireAdmin, (req, res) => {
  db.all('SELECT id, username FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});
app.delete('/admin/users/:id', auth, requireAdmin, (req, res) => {
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.run('DELETE FROM playlists WHERE user_id = ?', [req.params.id]);
    db.run('DELETE FROM liked WHERE user_id = ?', [req.params.id]);
    res.json({ success: true });
  });
});
app.get('/admin/playlists', auth, requireAdmin, (req, res) => {
  db.all('SELECT * FROM playlists', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});
app.delete('/admin/playlists/:id', auth, requireAdmin, (req, res) => {
  db.run('DELETE FROM playlists WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [req.params.id]);
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 