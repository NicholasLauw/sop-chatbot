// ─── SOP Chatbot Backend ─────────────────────────────────────────────
// Holds the password check, session cookies, and the Gemini API key
// server-side. The browser never sees GEMINI_API_KEY or the password.

require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config (set these as environment variables) ─────────────────────
const APP_PASSWORD   = process.env.APP_PASSWORD || 'changeme';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY is not set. /api/chat will return an error until it is configured.');
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── Simple signed session token (HMAC) ───────────────────────────────
function makeSessionToken() {
  const payload = `ok.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function isValidSessionToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [marker, ts, sig] = parts;
  const payload = `${marker}.${ts}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  // Constant-time comparison
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Auth middleware ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (isValidSessionToken(token)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ── Rate limiting (per session, in-memory) ───────────────────────────
// Keyed by session token rather than IP, so multiple staff sharing the
// same hotel WiFi (and therefore the same public IP) each get their own
// quota instead of being throttled together.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX       = 20;        // max requests per window
const RATE_LIMIT_BURST     = 5;         // small burst allowance on top

const rateLimitBuckets = new Map(); // sessionToken -> array of request timestamps

// Periodically clear out old buckets so memory doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, timestamps] of rateLimitBuckets.entries()) {
    const recent = timestamps.filter(t => t > cutoff);
    if (recent.length === 0) rateLimitBuckets.delete(key);
    else rateLimitBuckets.set(key, recent);
  }
}, 5 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  const token = req.cookies && req.cookies.session;
  const key = token || req.ip; // fall back to IP if no session somehow
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = (rateLimitBuckets.get(key) || []).filter(t => t > cutoff);
  const limit = RATE_LIMIT_MAX + RATE_LIMIT_BURST;

  if (timestamps.length >= limit) {
    const retryAfterMs = timestamps[0] - cutoff;
    res.set('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
    return res.status(429).json({
      error: 'You\'re sending messages too quickly. Please wait a moment and try again.'
    });
  }

  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  next();
}

// ── Login endpoint ────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};

  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Password required' });
  }

  // Constant-time-ish comparison of password
  const a = Buffer.from(password);
  const b = Buffer.from(APP_PASSWORD);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = makeSessionToken();
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
  });

  res.json({ ok: true });
});

// ── Logout endpoint ───────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// ── Check session endpoint (used by frontend on load) ────────────────
app.get('/api/session', (req, res) => {
  const token = req.cookies && req.cookies.session;
  res.json({ authenticated: isValidSessionToken(token) });
});

// ── Chat endpoint (proxies to Gemini, requires auth) ──────────────────
app.post('/api/chat', requireAuth, rateLimit, async (req, res) => {
  try {
    const { systemPrompt, contents } = req.body || {};

    if (!Array.isArray(contents)) {
      return res.status(400).json({ error: 'Invalid request: contents must be an array' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server is not configured with a Gemini API key.' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt || '' }] },
        contents,
        generationConfig: { temperature: 0.35, topK: 40, topP: 0.9, maxOutputTokens: 1200 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });

    const rawText = await geminiRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error('Non-JSON response from Gemini:', rawText.slice(0, 300));
      return res.status(502).json({ error: 'Upstream API returned an invalid response.' });
    }

    if (!geminiRes.ok) {
      const message = data?.error?.message || `Gemini HTTP ${geminiRes.status}`;
      return res.status(geminiRes.status).json({ error: message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: 'Empty response from Gemini.' });
    }

    res.json({ text });
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Static files ──────────────────────────────────────────────────────
// index.html itself is gated client-side by checking /api/session first,
// but assets (css/js are inline, images/manifest/sw) are public.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`SOP chatbot server listening on port ${PORT}`);
});
