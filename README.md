# SOP Chatbot — Backend Setup

This version adds a Node.js/Express backend that:

- Serves the chatbot UI (`public/index.html`)
- Requires a password before the chat UI is usable
- Holds your **Gemini API key on the server** — the browser never sees it
- Proxies chat requests through `/api/chat`

## 1. Install dependencies

```bash
npm install
```

## 2. Configure secrets

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

Edit `.env`:

```
APP_PASSWORD=your-staff-password
GEMINI_API_KEY=your-real-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash-lite
SESSION_SECRET=<generate with the command below>
NODE_ENV=production
```

Generate a strong `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Never commit `.env` to git.**

## 3. Run it

```bash
npm start
```

Visit `http://localhost:3000`. You'll be asked for the password before the
chat loads. After entering the correct password, a session cookie (12 hours)
is set and chat requests are proxied through the server.

## How it works

- `POST /api/login` — checks the password against `APP_PASSWORD`, sets a
  signed `session` cookie on success.
- `GET /api/session` — tells the frontend if the current cookie is valid
  (used on page load to decide whether to show the login screen).
- `POST /api/chat` — requires a valid session cookie. Calls Gemini using
  `GEMINI_API_KEY` from the server environment and returns just the reply
  text.
- `POST /api/logout` — clears the session cookie.

The frontend (`public/index.html`) no longer contains any API keys. The
`GEMINI_API_KEY` that used to be hardcoded in the HTML has been removed —
**rotate/revoke that old key in Google AI Studio**, since it was exposed in
the file you uploaded.

## Notes on the SOP file / Google Drive key

The uploaded HTML also had a Google Drive API key and share link hardcoded
for auto-loading the SOP PDF. Those have been removed too (and that Drive
key should be rotated/restricted as well, since it was exposed). You can:

- Re-add a Drive key in the `GDRIVE_SOP_URL` / `GOOGLE_DRIVE_API_KEY`
  constants near the top of the `<script>` in `index.html` (this key only
  grants read access to public Drive files, so it's lower risk — but you
  can still move it server-side later using the same pattern as the Gemini
  key), or
- Put your SOP file in `public/` and set `SOP_FILE_PATH` accordingly, or
- Use the in-app "Upload SOP" button (works fully client-side, no key
  needed).

## Deploying

This is a standard Express app — deploy it anywhere that runs Node 18+
(Render, Railway, Fly.io, a VPS, etc.). Set `APP_PASSWORD`, `GEMINI_API_KEY`,
`SESSION_SECRET`, and `NODE_ENV=production` as environment variables in your
hosting provider's dashboard (don't upload `.env` itself). Make sure the app
is served over HTTPS in production so the session cookie's `secure` flag
works correctly.
