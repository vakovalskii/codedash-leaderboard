const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// --- Database setup ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'leaderboard.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    avatar TEXT,
    name TEXT,
    device_count INTEGER DEFAULT 1,
    verified INTEGER DEFAULT 0,
    stats TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS devices (
    username TEXT,
    device_id TEXT,
    stats TEXT,
    updated_at TEXT,
    PRIMARY KEY (username, device_id)
  );

  CREATE TABLE IF NOT EXISTS heartbeats (
    anon_id TEXT PRIMARY KEY,
    version TEXT,
    platform TEXT,
    agents TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_active (
    date TEXT,
    anon_id TEXT,
    PRIMARY KEY (date, anon_id)
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    timestamp INTEGER
  );
`);

// --- Prepared statements ---
const stmts = {
  getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
  upsertUser: db.prepare(`
    INSERT INTO users (username, avatar, name, device_count, verified, stats, updated_at)
    VALUES (@username, @avatar, @name, @device_count, @verified, @stats, @updated_at)
    ON CONFLICT(username) DO UPDATE SET
      avatar = @avatar, name = @name, device_count = @device_count,
      verified = @verified, stats = @stats, updated_at = @updated_at
  `),
  getDevices: db.prepare('SELECT * FROM devices WHERE username = ?'),
  upsertDevice: db.prepare(`
    INSERT INTO devices (username, device_id, stats, updated_at)
    VALUES (@username, @device_id, @stats, @updated_at)
    ON CONFLICT(username, device_id) DO UPDATE SET
      stats = @stats, updated_at = @updated_at
  `),
  getAllUsers: db.prepare('SELECT * FROM users ORDER BY updated_at DESC'),
  deleteUser: db.prepare('DELETE FROM users WHERE username = ?'),
  deleteDevices: db.prepare('DELETE FROM devices WHERE username = ?'),

  upsertHeartbeat: db.prepare(`
    INSERT INTO heartbeats (anon_id, version, platform, agents, updated_at)
    VALUES (@anon_id, @version, @platform, @agents, @updated_at)
    ON CONFLICT(anon_id) DO UPDATE SET
      version = @version, platform = @platform, agents = @agents, updated_at = @updated_at
  `),
  upsertDailyActive: db.prepare(`
    INSERT OR IGNORE INTO daily_active (date, anon_id) VALUES (@date, @anon_id)
  `),
  countActiveHeartbeats: db.prepare(
    'SELECT COUNT(*) as count FROM heartbeats WHERE updated_at > ?'
  ),
  countTotalHeartbeats: db.prepare('SELECT COUNT(*) as count FROM heartbeats'),
  countDailyActive: db.prepare(
    'SELECT COUNT(*) as count FROM daily_active WHERE date = ?'
  ),

  getRateLimit: db.prepare('SELECT timestamp FROM rate_limits WHERE key = ?'),
  upsertRateLimit: db.prepare(`
    INSERT INTO rate_limits (key, timestamp) VALUES (@key, @timestamp)
    ON CONFLICT(key) DO UPDATE SET timestamp = @timestamp
  `),

  cleanExpiredHeartbeats: db.prepare('DELETE FROM heartbeats WHERE updated_at < ?'),
  cleanExpiredRateLimits: db.prepare('DELETE FROM rate_limits WHERE timestamp < ?'),
};

// --- Cleanup task ---
function cleanup() {
  const now = Date.now();
  const cutoff48h = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const cutoff2m = now - 2 * 60 * 1000;
  stmts.cleanExpiredHeartbeats.run(cutoff48h);
  stmts.cleanExpiredRateLimits.run(cutoff2m);
}
setInterval(cleanup, 5 * 60 * 1000);
cleanup();

// --- Merge devices logic ---
function mergeDevices(devices) {
  const today = { messages: 0, hours: 0, sessions: 0, cost: 0, agents: {} };
  const week = { messages: 0, hours: 0, cost: 0 };
  const totals = { messages: 0, hours: 0, sessions: 0, cost: 0 };
  const agents = {};
  let streak = 0, activeDays = 0;

  for (const device of devices) {
    let s;
    try { s = JSON.parse(device.stats); } catch { continue; }

    if (s.today) {
      today.messages += s.today.messages || 0;
      today.hours += s.today.hours || 0;
      today.sessions += s.today.sessions || 0;
      today.cost += s.today.cost || 0;
      for (const [a, c] of Object.entries(s.today.agents || {})) today.agents[a] = (today.agents[a] || 0) + c;
    }
    if (s.week) {
      week.messages += s.week.messages || 0;
      week.hours += s.week.hours || 0;
      week.cost += s.week.cost || 0;
    }
    if (s.totals) {
      totals.messages += s.totals.messages || 0;
      totals.hours += s.totals.hours || 0;
      totals.sessions += s.totals.sessions || 0;
      totals.cost += s.totals.cost || 0;
    }
    streak = Math.max(streak, s.streak || 0);
    activeDays = Math.max(activeDays, s.activeDays || 0);
    for (const [a, c] of Object.entries(s.agents || {})) agents[a] = (agents[a] || 0) + (c || 0);
  }

  // Round
  [today, week, totals].forEach(o => {
    if (o.hours) o.hours = Math.round(o.hours * 10) / 10;
    if (o.cost) o.cost = Math.round(o.cost * 100) / 100;
  });

  return { today, week, totals, agents, streak, activeDays };
}

// --- GitHub token verification ---
async function verifyGitHub(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'CodeDash-Leaderboard/1.0',
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data;
}

// --- HTTP helpers ---
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// --- Static file serving ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
}

// --- Routes ---
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname === '/api/stats' && req.method === 'POST') {
    return handleStats(req, res);
  }
  if (pathname === '/api/heartbeat' && req.method === 'POST') {
    return handleHeartbeat(req, res);
  }
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    return handleLeaderboard(req, res);
  }
  if (pathname === '/api/network' && req.method === 'GET') {
    return handleNetwork(req, res);
  }
  if (pathname.startsWith('/api/user/') && req.method === 'GET') {
    const username = decodeURIComponent(pathname.slice('/api/user/'.length));
    return handleGetUser(req, res, username);
  }

  // Static files
  serveStatic(req, res);
}

async function handleStats(req, res) {
  try {
    const body = await parseBody(req);
    const { username, stats, deviceId } = body;

    // Support token in body (codedash client) or Authorization header
    let token = body.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
    }
    if (!token) return sendJSON(res, 401, { error: 'Missing authorization token' });

    if (!username || !stats || !deviceId) {
      return sendJSON(res, 400, { error: 'Missing required fields: username, stats, deviceId' });
    }

    // Rate limit: 1 sync per user per 60 seconds
    const rateLimitKey = `stats:${username}`;
    const rl = stmts.getRateLimit.get(rateLimitKey);
    const now = Date.now();
    if (rl && now - rl.timestamp < 60000) {
      return sendJSON(res, 429, {
        error: 'Rate limited',
        retryAfter: Math.ceil((60000 - (now - rl.timestamp)) / 1000),
      });
    }

    // Verify GitHub token
    const ghUser = await verifyGitHub(token);
    if (!ghUser || ghUser.login.toLowerCase() !== username.toLowerCase()) {
      return sendJSON(res, 403, { error: 'GitHub token verification failed' });
    }

    // Validate stats
    if (stats.today) {
      if (stats.today.messages > 5000) stats.today.messages = 5000;
      if (stats.today.hours > 48) stats.today.hours = 48;
    }

    // Update rate limit
    stmts.upsertRateLimit.run({ key: rateLimitKey, timestamp: now });

    // Store device stats
    const nowISO = new Date().toISOString();
    stmts.upsertDevice.run({
      username: ghUser.login,
      device_id: deviceId,
      stats: JSON.stringify(stats),
      updated_at: nowISO,
    });

    // Merge all devices for this user
    const devices = stmts.getDevices.all(ghUser.login);
    const merged = mergeDevices(devices);

    // Update user record
    stmts.upsertUser.run({
      username: ghUser.login,
      avatar: ghUser.avatar_url || '',
      name: ghUser.name || ghUser.login,
      device_count: devices.length,
      verified: 1,
      stats: JSON.stringify(merged),
      updated_at: nowISO,
    });

    return sendJSON(res, 200, { ok: true, merged });
  } catch (e) {
    console.error('POST /api/stats error:', e.message);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

async function handleHeartbeat(req, res) {
  try {
    const body = await parseBody(req);
    const { anonId, version, platform, agents } = body;

    if (!anonId) {
      return sendJSON(res, 400, { error: 'Missing anonId' });
    }

    const nowISO = new Date().toISOString();
    const today = nowISO.slice(0, 10);

    stmts.upsertHeartbeat.run({
      anon_id: anonId,
      version: version || 'unknown',
      platform: platform || 'unknown',
      agents: JSON.stringify(agents || []),
      updated_at: nowISO,
    });

    stmts.upsertDailyActive.run({
      date: today,
      anon_id: anonId,
    });

    return sendJSON(res, 200, { ok: true });
  } catch (e) {
    console.error('POST /api/heartbeat error:', e.message);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

function handleLeaderboard(req, res) {
  try {
    const users = stmts.getAllUsers.all().map((u) => ({
      username: u.username,
      avatar: u.avatar,
      name: u.name,
      deviceCount: u.device_count,
      verified: !!u.verified,
      stats: JSON.parse(u.stats || '{}'),
      updatedAt: u.updated_at,
    }));

    // Sort by today messages desc, then totals
    users.sort((a, b) => (b.stats?.today?.messages || 0) - (a.stats?.today?.messages || 0)
      || (b.stats?.totals?.messages || 0) - (a.stats?.totals?.messages || 0));

    // Network stats
    const now = new Date();
    const cutoff48h = new Date(now.getTime() - 48 * 3600000).toISOString();
    const today = now.toISOString().slice(0, 10);
    const totalInstalls = stmts.countTotalHeartbeats.get().count;
    const todayActive = stmts.countDailyActive.get(today).count;

    return sendJSON(res, 200, {
      users,
      totalUsers: users.length,
      network: { totalInstalls, todayActive },
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    console.error('GET /api/leaderboard error:', e.message);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

function handleNetwork(req, res) {
  try {
    const now = new Date();
    const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const today = now.toISOString().slice(0, 10);

    const totalInstalls = stmts.countTotalHeartbeats.get().count;
    const activeNow = stmts.countActiveHeartbeats.get(cutoff48h).count;
    const activeToday = stmts.countDailyActive.get(today).count;
    const usersOnBoard = stmts.getAllUsers.all().length;

    return sendJSON(res, 200, {
      totalInstalls,
      activeNow,
      activeToday,
      usersOnBoard,
    });
  } catch (e) {
    console.error('GET /api/network error:', e.message);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

function handleGetUser(req, res, username) {
  try {
    const user = stmts.getUser.get(username);
    if (!user) return sendJSON(res, 404, { error: 'User not found' });

    return sendJSON(res, 200, {
      username: user.username,
      avatar: user.avatar,
      name: user.name,
      deviceCount: user.device_count,
      verified: !!user.verified,
      stats: JSON.parse(user.stats || '{}'),
      updatedAt: user.updated_at,
    });
  } catch (e) {
    console.error('GET /api/user error:', e.message);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

// --- Start server ---
const PORT = parseInt(process.env.PORT || '3000', 10);
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`CodeDash Leaderboard running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => { db.close(); process.exit(0); });
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => { db.close(); process.exit(0); });
});
