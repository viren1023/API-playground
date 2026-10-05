# Request Lab

A local-first HTTP workbench for browser-based API testing. The Chromium extension sends requests so APIs on `localhost` do not need CORS enabled. Requests and tabs are stored only in browser IndexedDB; response bodies are never persisted.

## Run the app

```powershell
cd web
npm install
npm run dev
```

Open `http://localhost:5173`. The production build is `npm run build`; preview it with `npm run preview` on `http://localhost:4173`. Run unit tests with `npm test` from `web/`.

## Load the extension

In Chrome, Edge, or Brave, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension/` directory. Reload the app page after installing. The extension grants `<all_urls>` host access to allow requests to arbitrary APIs; credentials are omitted and request/response handling stays local.

The extension allows `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173`, and `http://127.0.0.1:4173`. For a deployed app such as `https://my-api-tester.pages.dev`, add `https://my-api-tester.pages.dev/*` to `matches` in `extension/manifest.json` and `https://my-api-tester.pages.dev` to `ALLOWED_ORIGINS` in `extension/content.js`; reload the extension and app.

Browser direct mode uses page `fetch`, so target servers must send CORS headers. HTTPS pages also cannot call insecure HTTP targets because of mixed-content restrictions.

## Test APIs

Both local test servers intentionally omit CORS headers. Start either implementation:

```powershell
cd test-servers/express
npm install
node server.js
```

```powershell
cd test-servers/fastapi
python -m pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Express listens on port `3000`; FastAPI listens on port `8000`. Both include `/ping`, `/echo`, `/status/{code}`, `/slow`, `/big`, `/bigint`, `/html`, `/image`, `/redirect`, `/sse`, `/empty`, and `/latin1`.

## Deploy

Deploy the static `web/` directory with Vercel, Netlify, or Cloudflare Pages. Build command: `npm run build` with `web/` as the project root; output directory: `dist`. `web/public/_headers` includes the suggested production security headers. Add the deployment origin to both extension origin lists and reload the extension.

## Known limitations

- Chromium only. Cookies are omitted; `Set-Cookie`, full redirect chains, and HTTP version are not exposed.
- Direct mode sees only CORS-exposed response headers.
- Response bodies are limited to 20 MB; request bodies are limited to 25 MB. Very large JSON bodies display as raw text.
- Form-data file bytes are memory-only and must be re-attached after restoring a saved tab.
- IndexedDB uses last-write-wins across app tabs; live cross-tab synchronization is not included.
- The extension's broad host permission is intended for local unpacked use. Store publication requires justification.

## Deviations

- The plan's app files live in `web/` under this repository root; no additional outer project directory is created.
- The visual JSON warning uses native JSON syntax validation; lossless parsing is used for formatting and response display so large numeric values remain exact.