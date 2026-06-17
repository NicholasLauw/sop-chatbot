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
    maxAge: 1000 * 60 * 60, // 1 hours
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
app.post('/api/chat', requireAuth, async (req, res) => {
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
        generationConfig: {
          temperature: 0.35,
          topK: 40,
          topP: 0.9,
          maxOutputTokens: 4096,
          // 2.5-series models spend part of maxOutputTokens on internal "thinking"
          // before writing the visible answer. This task is straightforward
          // SOP lookup, not multi-step reasoning, so we turn thinking off to
          // keep the full token budget available for the actual answer.
          thinkingConfig: { thinkingBudget: 0 },
        },
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

    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      const reason = candidate?.finishReason;
      if (reason === 'MAX_TOKENS') {
        console.error('Gemini response truncated: hit maxOutputTokens with no visible text yet.');
        return res.status(502).json({ error: 'The answer was too long and got cut off before any text was written. Try asking a more specific question.' });
      }
      return res.status(502).json({ error: 'Empty response from Gemini.' });
    }

    if (candidate?.finishReason === 'MAX_TOKENS') {
      console.warn('Gemini response was truncated (hit maxOutputTokens).');
    }

    res.json({ text, truncated: candidate?.finishReason === 'MAX_TOKENS' });
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
