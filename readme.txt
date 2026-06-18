Account Yang Dibutuhkan
===============================
- Google AI Studio: Google Gemini API Key (Stored in .env file)
- Google Cloud: Google Drive API Key (Stored in HTML file)
- Google Drive: Tempat Store SOP Document in PDF FORM (Stored in HTML file)


HOTEL SOP ASSISTANT — PWA SETUP
================================

FILES (keep all of these together in ONE folder):
  hotel-sop-chatbot.html   ← the app
  manifest.webmanifest     ← PWA manifest
  sw.js                    ← service worker (offline + install)
  icon-192.png
  icon-512.png
  icon-maskable-512.png

------------------------------------------------------------
1. LOADING THE SOP FROM GOOGLE DRIVE  (recommended)
------------------------------------------------------------
a) Upload your SOP PDF to Google Drive.
b) Right-click it → Share → "Anyone with the link" → Viewer.
c) Copy the share link.
d) Get a Google API key:
     - Go to console.cloud.google.com
     - Create/select a project
     - "APIs & Services" → "Enable APIs" → enable "Google Drive API"
     - "Credentials" → "Create credentials" → "API key" → copy it
     - (Recommended) Restrict the key to the Drive API and to your
       website's domain.
e) Open hotel-sop-chatbot.html in a text editor and fill in, near the top:
       const GDRIVE_SOP_URL       = 'PASTE_YOUR_DRIVE_LINK';
       const GOOGLE_DRIVE_API_KEY = 'PASTE_YOUR_API_KEY';
   The app will now auto-load that PDF on startup.

   You can also load a Drive link at any time with the "From Drive"
   button — no editing required (but the API key must still be set).

ALTERNATIVES (used automatically if no Drive link is set):
  - "Upload SOP" button: pick a PDF/TXT/MD from the device. Always works.
  - Local file: put a PDF next to the HTML and set SOP_FILE_PATH.

------------------------------------------------------------
2. HOSTING (required for PWA install + Google Drive)
------------------------------------------------------------
A PWA must be served over HTTPS (or http://localhost). Opening the
file directly (file://) will NOT allow install or service worker.

Easy free options — upload the whole folder to any of:
  - Netlify (drag-and-drop the folder onto app.netlify.com)
  - GitHub Pages
  - Cloudflare Pages
  - Firebase Hosting
  - Or any web server you already have.

Quick local test:
     python -m http.server 8000
   then open  http://localhost:8000/hotel-sop-chatbot.html

------------------------------------------------------------
3. INSTALLING ON A PHONE / DESKTOP
------------------------------------------------------------
Once hosted over HTTPS:
  - Android / Chrome: an "Install" button appears in the app's top bar,
    or use the browser menu → "Install app" / "Add to Home screen".
  - iPhone / Safari: Share → "Add to Home Screen".
  - Desktop Chrome/Edge: install icon in the address bar, or the in-app
    "Install" button.

------------------------------------------------------------
NOTES
------------------------------------------------------------
- Scanned (image-only) PDFs have no text layer and cannot be read.
  Use a PDF with selectable text.
- Answers and Drive loading need an internet connection. The app shell
  opens offline; an SOP already loaded this session stays usable.
- If you change any file, bump the CACHE name in sw.js (e.g. v1 → v2)
  so devices pick up the new version.
