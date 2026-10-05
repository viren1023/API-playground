# API Tester — Build Plan (for a coding agent)

Build a free, Postman-like web app for sending HTTP requests and viewing responses, including to APIs running on the user's own machine (Node.js, FastAPI, etc.). A companion **browser extension** performs the actual requests so CORS does not apply.

Read this whole file before writing code. Build everything in one pass, then run the verification checklist at the end.

---

## 1. Goals and non-goals

**v1 goals**
- Build a request (method, URL, query params, headers, body), send it, and view the response (status, time, size, headers, body).
- Works against `localhost` / `127.0.0.1` backends and any public API, with no CORS setup on the target server.
- All data stays in the browser (IndexedDB). No accounts, no backend, no analytics, no telemetry.
- Runs fully free on a laptop: `npm run dev` for the web app, "Load unpacked" for the extension.

**Explicitly out of scope for v1** (do not build; keep the code easy to extend)
- Collections, request history, environment variables, auth helpers (Bearer/Basic/OAuth), cURL import/export, OpenAPI import, test scripts/assertions, team sharing, WebSocket/gRPC/GraphQL-specific UI, cookie jar, response streaming display.
- Firefox/Safari support (Chromium browsers only: Chrome, Edge, Brave).

---

## 2. Tech stack and decisions

| Area | Choice | Reason |
|---|---|---|
| Web app | React 18 + Vite + TypeScript | Standard, fast dev server |
| Styling | Tailwind CSS (current stable; follow its official Vite install guide) | Speed |
| State | Zustand | Small, no boilerplate |
| Persistence | Dexie (IndexedDB wrapper) | Versioned schema, easy migrations |
| Code viewer/editor | CodeMirror 6 (`@codemirror/*`, JSON + HTML + XML + plain text) | Handles large text, lightweight |
| JSON formatting | `lossless-json` | `JSON.parse` + `JSON.stringify` corrupts integers above 2^53 |
| Unit tests | Vitest (pure functions only) | Fast |
| Extension | **Plain JavaScript, Manifest V3, no build step** | Fewest moving parts; loads unpacked directly from `/extension` |
| Extension ↔ page bridge | Content script + `window.postMessage` | Works with `localhost` origins and is not limited by `externally_connectable` quirks |

Do not add a UI component library, a router, or a CSS-in-JS library. Do not add any runtime dependency not listed above unless truly required.

---

## 3. Repository layout

```
api-tester/
├─ README.md
├─ web/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ tsconfig.json
│  ├─ public/_headers              # production CSP for Netlify/Cloudflare Pages (see §10)
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx
│     ├─ lib/
│     │  ├─ protocol.ts            # message types shared by bridge + direct mode
│     │  ├─ bridge.ts              # talks to the extension via postMessage
│     │  ├─ directFetch.ts         # optional "browser direct" mode
│     │  ├─ sendRequest.ts         # picks bridge or direct, normalizes result
│     │  ├─ url.ts                 # normalize URL, params <-> URL sync
│     │  ├─ headers.ts             # header validation + forbidden-header list
│     │  ├─ body.ts                # build wire body from UI state
│     │  ├─ response.ts            # decode body, detect type, format
│     │  ├─ base64.ts              # chunked base64 encode/decode
│     │  └─ format.ts              # bytes, ms, JSON pretty-printing
│     ├─ store/tabs.ts             # Zustand store: tabs, active tab, in-flight state
│     ├─ db/db.ts                  # Dexie schema + load/save helpers
│     └─ components/
│        ├─ TopBar.tsx             # app name, extension status pill, theme toggle
│        ├─ TabStrip.tsx
│        ├─ RequestPanel.tsx       # method + URL + Send/Cancel + sub-tabs
│        ├─ KeyValueTable.tsx      # params, headers, urlencoded, form-data
│        ├─ BodyEditor.tsx
│        ├─ ResponsePanel.tsx
│        ├─ CodeView.tsx           # CodeMirror wrapper (read-only / editable)
│        ├─ ExtensionBanner.tsx
│        └─ ErrorCard.tsx
├─ extension/
│  ├─ manifest.json
│  ├─ background.js
│  ├─ content.js
│  └─ README.md
└─ test-servers/
   ├─ express/ (package.json, server.js)
   └─ fastapi/ (requirements.txt, main.py)
```

---

## 4. Extension specification

### 4.1 `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "API Tester Bridge",
  "version": "1.0.0",
  "description": "Lets the API Tester web app send requests to localhost and other servers without CORS limits.",
  "minimum_chrome_version": "110",
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": [
        "http://localhost:5173/*", "http://127.0.0.1:5173/*",
        "http://localhost:4173/*", "http://127.0.0.1:4173/*"
      ],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```

- If Chrome rejects ports in `matches`, use `http://localhost/*` and `http://127.0.0.1/*` instead. In all cases `content.js` must also check `location.origin` against its own hard-coded `ALLOWED_ORIGINS` array and do nothing if it is not listed.
- The README must explain how to add a deployed URL (e.g. `https://my-api-tester.pages.dev`) to both `matches` and `ALLOWED_ORIGINS`.

### 4.2 Message protocol (protocol version = 1)

Page ↔ content script uses `window.postMessage`. Every message has a namespace so unrelated messages are ignored:

```ts
// page -> extension
{ source: "api-tester-page", type: "PING" }
{ source: "api-tester-page", type: "SEND_REQUEST", id: string, payload: WireRequest }
{ source: "api-tester-page", type: "CANCEL_REQUEST", id: string }

// extension -> page
{ source: "api-tester-ext", type: "READY", version: string, protocol: 1 }
{ source: "api-tester-ext", type: "PONG",  version: string, protocol: 1 }
{ source: "api-tester-ext", type: "HEARTBEAT", id: string }          // optional, internal
{ source: "api-tester-ext", type: "RESULT", id: string, result: WireResponse }
```

```ts
type WireBody =
  | { kind: "none" }
  | { kind: "text"; text: string; contentType?: string }           // JSON / raw
  | { kind: "urlencoded"; pairs: [string, string][] }
  | { kind: "formdata"; parts: Array<
      | { type: "text"; key: string; value: string }
      | { type: "file"; key: string; filename: string; mime: string; dataBase64: string }
    > };

interface WireRequest {
  method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD"|"OPTIONS";
  url: string;                       // final absolute URL, params already applied
  headers: [string, string][];       // enabled headers only
  body: WireBody;
  timeoutMs: number;                 // 0 = none; clamp to 0..300000
}

interface WireResponse {
  ok: boolean;                       // true if we got an HTTP response (even 4xx/5xx)
  status?: number; statusText?: string;
  url?: string; redirected?: boolean;
  headers?: [string, string][];
  bodyBase64?: string;               // may be truncated
  bodyBytes?: number;                // bytes actually received
  truncated?: boolean;               // hit MAX_RESPONSE_BYTES
  contentType?: string;
  timing?: { ttfbMs: number; totalMs: number };
  error?: { code: ErrorCode; message: string; hint?: string };
}

type ErrorCode = "NETWORK" | "TIMEOUT" | "CANCELLED" | "INVALID_REQUEST"
               | "BODY_TOO_LARGE" | "EXTENSION_RELOADED" | "UNKNOWN";
```

### 4.3 `content.js` rules
1. Exit immediately if `location.origin` is not in `ALLOWED_ORIGINS`.
2. Post `READY` once on load, and reply to `PING` with `PONG`.
3. Accept messages only if `event.source === window`, `event.origin === location.origin`, and `data.source === "api-tester-page"`.
4. For `SEND_REQUEST`: open a `chrome.runtime.connect({ name: "api-tester" })` port, post the request, forward `HEARTBEAT`/`RESULT` to the page, and close the port after the result. For `CANCEL_REQUEST`: post a cancel message on the same port.
5. Wrap every `chrome.runtime.*` call in `try/catch`. If it throws (e.g. "Extension context invalidated" after the extension was reloaded), post a `RESULT` with `error.code = "EXTENSION_RELOADED"` and hint "Reload this page".
6. Never expose any `chrome.*` API or generic proxy function to the page.

### 4.4 `background.js` rules
- Keep `Map<id, { controller, port }>` for in-flight requests.
- On port message `SEND_REQUEST`: **re-validate everything** (never trust the page):
  - Method is in the whitelist.
  - URL parses with `new URL()` and protocol is exactly `http:` or `https:` (reject `file:`, `chrome:`, `chrome-extension:`, `data:`, `javascript:`, `blob:`, `ftp:`).
  - Header names match `^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$`; header values contain only chars 0x09 and 0x20–0xFF (no CR/LF, no non-Latin1).
  - Total decoded request body ≤ `MAX_REQUEST_BYTES` (25 MB).
  - `timeoutMs` clamped to 0–300000.
- Build the fetch call:
  ```js
  fetch(url, { method, headers, body, credentials: "omit", cache: "no-store", redirect: "follow", signal })
  ```
  - `credentials: "omit"` so the browser's logged-in cookies are never sent to arbitrary URLs.
  - Always follow redirects; `redirect: "manual"` yields an unusable opaque response in extension context. Report `res.url` and `res.redirected` instead.
  - Do not send a body for `GET` and `HEAD`.
  - For `urlencoded`: build a `URLSearchParams` string and set `Content-Type: application/x-www-form-urlencoded` if the user did not set one.
  - For `formdata`: build a real `FormData` (files via `Blob` from base64) and **delete any user-set `Content-Type` header** so fetch generates the multipart boundary.
  - For `text`: set `Content-Type` from `body.contentType` only if the user did not set one.
- Timing: `t0 = performance.now()` before fetch; `ttfbMs` when headers arrive; `totalMs` after the body is read.
- Read the body via `res.body.getReader()`, accumulating chunks. If total exceeds `MAX_RESPONSE_BYTES` (20 MB), `reader.cancel()` and set `truncated = true`. This also bounds never-ending streams such as `text/event-stream`.
- Encode to base64 in **chunks** (e.g. 32 KB slices through `String.fromCharCode.apply`) — spreading a large array into `fromCharCode` overflows the stack.
- **Service worker lifetime:** MV3 service workers can be killed while idle. While a request is in flight, send a `HEARTBEAT` on the port every 20 s (and clear the interval in `finally`); port messages reset the idle timer.
- Timeout is implemented with `AbortController` + `setTimeout`; distinguish `TIMEOUT` from user `CANCELLED` (track which one aborted).
- On port `onDisconnect` (page closed/reloaded), abort all in-flight requests tied to that port.
- Classify errors: `fetch` throws a generic `TypeError: Failed to fetch` for almost everything, so return `NETWORK` with a **hint list** (see §7, "Network error hints").
- Never `console.log` request headers or bodies.

---

## 5. Web app specification

### 5.1 Layout
- **Top bar:** app name, extension status pill (Connected v1.0.0 / Not detected / Update needed), "Send via" switch (Extension | Browser direct), dark/light toggle (default follows `prefers-color-scheme`).
- **Tab strip:** multiple request tabs; new, close, duplicate, rename on double-click; max 20 tabs; always keep at least one tab.
- **Request panel:** method select + URL input + Send button (becomes Cancel while in flight). Sub-tabs: **Params**, **Headers**, **Body**, **Settings** (timeout).
- **Response panel:** status badge (colored by class), time, size; tabs **Body** and **Headers**. Side by side on wide screens, stacked on narrow ones.
- Keyboard: `Ctrl/Cmd+Enter` sends, `Esc` cancels an in-flight request.

### 5.2 Extension detection (`bridge.ts`)
- On mount, listen for `READY` and also send `PING`; if no `PONG`/`READY` within 1500 ms, status = `missing`. Re-check when the tab becomes visible again.
- Check `protocol === 1`; otherwise show "Update needed".
- `ExtensionBanner` when missing: explains the 3 steps to load the unpacked extension, notes that **the page must be reloaded after installing** (content scripts do not attach to already-open tabs), and offers a "Use browser direct mode (needs CORS enabled on your server)" button.
- Requests use a `Map<id, {resolve}>`; unknown ids are ignored; each request gets a `crypto.randomUUID()` id.
- Add a client-side safety timeout of `timeoutMs + 10 s` (or 5 min if no timeout) so a lost message never leaves the UI stuck on "Sending…".

### 5.3 URL and params (`url.ts`)
- Normalization when sending: trim; if there is no scheme, prepend `http://` for `localhost`, `127.0.0.1`, `[::1]`, `*.local`, and private IP ranges (10.x, 172.16–31.x, 192.168.x), otherwise `https://`. Reject anything other than http/https with an inline error.
- The Params table and the URL query string stay in sync:
  - Typing in the URL parses its query into rows; editing rows rewrites the query part only.
  - **Disabled rows are kept in the table but not in the URL.** Preserve row order, duplicate keys, empty values, and keys without `=`.
  - Preserve the fragment (`#...`) in the field but do not send it.
  - Do not re-encode what the user typed unless they edit that row. Encode with `encodeURIComponent` semantics for newly typed values; show `%20` not `+` for spaces.
  - Leave `{{like_this}}` untouched (variables are a v2 feature).
- Build the final wire URL at send time from base URL + enabled rows.

### 5.4 Headers (`headers.ts`)
- Table with enable checkbox, name, value, delete. Inline validation using the same rules as §4.4. Invalid rows are highlighted and block sending with a clear message.
- Show a small warning icon on browser-restricted names (`Host`, `Origin`, `Referer`, `Cookie`, `Content-Length`, `Connection`, `Accept-Encoding`, `User-Agent`, `Sec-*`, `Proxy-*`, etc.): "The browser may ignore this header." They are still sent as-is; the extension does not guarantee them.
- Show a read-only hint above the table: "Content-Type will be set automatically to X" when the body type implies it and the user has not set one (case-insensitive name match). Never produce duplicate `Content-Type` headers.

### 5.5 Body (`body.ts`, `BodyEditor.tsx`)
- Modes: **None**, **JSON**, **Raw text**, **x-www-form-urlencoded**, **form-data**.
- JSON mode: CodeMirror editor with JSON syntax; show a non-blocking inline warning if the text is invalid JSON (still sendable). Include a "Beautify" button using `lossless-json`.
- form-data: rows of key + type (text/file) + value; file picker reads the file with `FileReader`, enforcing the 25 MB total cap before sending.
- For `GET` and `HEAD`, show the note "Body is not sent for this method" and do not include it.
- Do **not** persist file contents to IndexedDB. Persist only the filename and show "Re-attach file" after restoring a tab.

### 5.6 Response (`response.ts`, `ResponsePanel.tsx`)
- Decode bytes → text with `TextDecoder` using the `charset` from `Content-Type`; fall back to UTF-8 if the charset is unknown (wrap in `try/catch`).
- Classify the body as `json | html | xml | text | image | binary` from `Content-Type` plus a sniff (null bytes in the first 8 KB ⇒ binary).
- Body tab modes:
  - **Pretty:** JSON formatted with `lossless-json` (preserves large integers). If the body is > 5 MB, skip pretty-printing and show Raw with a notice. If parsing fails, show Raw.
  - **Raw:** exact text.
  - **Preview:** HTML in a `<iframe sandbox="" srcdoc=...>` (**no `allow-scripts`, no `allow-same-origin`**), images via a `blob:` URL created from the bytes (revoke on cleanup).
  - Binary: show size and content type, with a "Download" button; no inline rendering.
- Always provide **Copy** and **Download** buttons.
- Show a notice if `truncated` ("Response exceeded 20 MB; showing the first 20 MB").
- Headers tab: all response headers in a table. Note: `Set-Cookie` is never exposed to JavaScript; show a footnote.
- `HEAD`, `204`, and `304` responses have empty bodies; show "No body" rather than an empty editor.
- Status color classes: 1xx/3xx gray, 2xx green, 4xx amber, 5xx red; `ok:false` network errors use `ErrorCard`, not a status badge.
- **Size note:** size is the decoded body size (fetch transparently decompresses gzip/br), so it may differ from `Content-Length`.
- If the user edits the request while one is in flight, the response still attaches to the tab that made it (match by request id, not by active tab).

### 5.7 Direct mode (`directFetch.ts`)
- Same input and output shape as the extension path, implemented with the page's own `fetch` (`credentials: "omit"`, `cache: "no-store"`).
- Failures are shown with the extra hint: "Direct mode requires the server to send CORS headers, and an HTTPS page cannot call `http://` targets (mixed content)."
- Response headers are limited to CORS-exposed ones; show a notice in the Headers tab.

### 5.8 Persistence (`db.ts`)
- Dexie database `api-tester`, version 1:
  - `tabs`: `id, order, name, request, updatedAt` (`request` = method, url, params, headers, body descriptor, timeout).
  - `meta`: `key, value` (`activeTabId`, `theme`, `sendMode`).
- Debounce writes by 500 ms. Never store responses.
- If IndexedDB is unavailable or throws (private modes, quota), fall back to in-memory state and show a dismissible banner "Changes won't be saved".
- Design for schema upgrades via `db.version(n).stores(...)` so v2 tables (collections, history, environments) can be added without data loss.
- Multiple browser tabs of the app share the DB with last-write-wins; do not build cross-tab sync.

### 5.9 Error UX (`ErrorCard.tsx`)
Show the error message, the hint list (below), and a "Copy details" button. Never show a raw stack trace.

---

## 6. Test servers (for manual verification)

Create both with **CORS intentionally disabled** so we prove the extension bypasses it. Express on port 3000, FastAPI (uvicorn) on port 8000. Same endpoints in both:

| Endpoint | Behavior |
|---|---|
| `GET /ping` | `{"ok": true}` |
| `ANY /echo` | Returns JSON: method, path, query, headers, parsed body (JSON/form/multipart with file names and sizes) |
| `GET /status/:code` | Responds with that status code |
| `GET /slow?ms=5000` | Delays, then responds |
| `GET /big?mb=30` | Streams that many MB of text (exercises truncation) |
| `GET /bigint` | Returns `{"id": 9007199254740993}` (tests lossless JSON) |
| `GET /html` | Small HTML page |
| `GET /image` | Small PNG |
| `GET /redirect` | 302 to `/ping` |
| `GET /sse` | `text/event-stream` that never ends |
| `GET /empty` | 204 |
| `GET /latin1` | Body in `charset=iso-8859-1` with accented characters |

Each has a short README line with run commands (`node server.js`, `uvicorn main:app --reload`).

---

## 7. Edge case register

### Network error hints (shown in `ErrorCard` for `NETWORK`)
1. Is the server running, and on that port?
2. Try `127.0.0.1` instead of `localhost` (a server bound only to IPv4 or IPv6 can fail on the other). For uvicorn use `--host 127.0.0.1`.
3. `0.0.0.0` is not a valid address to call; use `127.0.0.1`.
4. HTTPS with a self-signed certificate fails; use `http://` locally or trust the certificate.
5. Chrome blocks some "unsafe" ports (e.g. 6000, 6665–6669, 10080); use a different port.
6. For public sites: check DNS, VPN, or proxy.

### Behavioral edge cases and required handling

| Case | Required handling |
|---|---|
| Page loaded before extension installed | Banner says reload after installing; re-check on tab focus |
| Extension reloaded while the page is open | `EXTENSION_RELOADED` error with "Reload this page" |
| Service worker killed mid-request | Heartbeats every 20 s; client-side safety timeout |
| User closes or reloads the page mid-request | Port `onDisconnect` aborts the fetch |
| Cancel clicked after the worker restarted | Cancel is a harmless no-op; UI still resets from the client timeout/cancel state |
| Another website tries to use the extension | Content script only runs on allowed origins and re-checks `event.origin`; no other site can message it |
| XSS in the web app would equal a localhost proxy | Strict CSP in production (§10), sandboxed preview iframe, no `dangerouslySetInnerHTML` anywhere |
| Non-http(s) URL schemes | Rejected in both UI and background |
| `GET`/`HEAD` with a body | Body not sent; UI explains |
| Duplicate `Content-Type`; manual `Content-Type` with form-data | Single header; form-data always lets fetch set the boundary |
| Invalid header names or non-Latin1 values | Inline validation; background rejects with `INVALID_REQUEST` |
| Cookies from the user's browser leaking to targets | `credentials: "omit"` always |
| Cached responses hiding changes | `cache: "no-store"` |
| Redirects | Always followed; show final URL and "redirected" badge |
| Huge response (> 20 MB) or endless stream | Capped, `truncated` notice, timeout applies |
| Huge request body or file | 25 MB cap enforced in UI and background (`BODY_TOO_LARGE`) |
| Base64 of large buffers | Chunked encoding and decoding (no spread into `fromCharCode`) |
| Message size over runtime limits | Covered by the caps above |
| Integers above 2^53 in JSON | `lossless-json` for display; never `JSON.parse` then `stringify` |
| Very large JSON | No pretty-print above 5 MB |
| Non-UTF-8 charsets, unknown charset labels | `TextDecoder` with `try/catch` fallback |
| Binary or image responses | No text decoding; image preview via `blob:` URL; download button |
| HTML response with scripts | Sandboxed iframe with no scripts |
| Disabled params/headers | Kept in UI, excluded from the wire request |
| Params with duplicates, empty values, fragments, unusual encoding | Preserved as typed (see §5.3) |
| Response for a tab the user navigated away from | Matched by request id |
| IndexedDB blocked or full | In-memory fallback with banner |
| Files in persisted form-data | Only filenames saved; re-attach prompt |
| Self-signed HTTPS | Clear hint; no bypass attempted |
| `Set-Cookie`, redirect chain, HTTP version | Not available; document in README under "Known limitations" |
| Production extension review | `<all_urls>` needs a justification if ever published; local use is unaffected |

---

## 8. Build order

1. Scaffold `web/` (Vite React TS, Tailwind, Zustand, Dexie, CodeMirror, `lossless-json`, Vitest) and `test-servers/`.
2. Write `protocol.ts`, `base64.ts`, `url.ts`, `headers.ts`, `body.ts`, `format.ts` with Vitest unit tests (see §9).
3. Write the extension (`manifest.json`, `content.js`, `background.js`) exactly per §4.
4. Write `bridge.ts`, `directFetch.ts`, `sendRequest.ts`.
5. Build the UI: store, request panel, tables, body editor, response panel, tab strip, top bar, banner, error card.
6. Add Dexie persistence and restore-on-load.
7. Write `README.md`: setup, loading the extension, adding origins, test servers, known limitations, how to deploy free (Vercel / Netlify / Cloudflare Pages) and add the deployed URL to the extension.
8. Run the verification checklist; fix everything that fails.

---

## 9. Unit tests (Vitest, pure functions)

- `url.ts`: scheme inference (localhost, IPs, public hosts), rejection of bad schemes, params↔URL round-trip with duplicates/empty/disabled/fragment.
- `headers.ts`: valid/invalid names and values, forbidden-name detection, Content-Type de-duplication.
- `body.ts`: wire body for each mode, GET/HEAD drops the body, form-data drops manual Content-Type.
- `base64.ts`: round-trip on 0 B, 1 B, 5 MB random data.
- `format.ts`: bytes/ms formatting; `lossless-json` keeps `9007199254740993`.
- `response.ts`: charset decoding (UTF-8, ISO-8859-1, unknown label), body type classification.

---

## 10. Production hardening (host files, not required for local use)

`web/public/_headers` for Netlify/Cloudflare Pages:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src *; frame-src about: blob: data:; object-src 'none'; base-uri 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

`connect-src *` is needed only for direct mode. Verify the HTML preview iframe still renders under this policy.

---

## 11. Verification checklist (must all pass)

**Setup**
- [ ] `cd web && npm install && npm run dev` serves on `http://localhost:5173` with no console errors.
- [ ] `npm run build && npm run preview` serves on `http://localhost:4173` and works the same.
- [ ] `npm test` passes.
- [ ] The extension loads unpacked in Chrome with no manifest errors; the status pill turns "Connected" after a page reload.

**Core flows (against both test servers)**
- [ ] GET `/ping` shows 200, time, size, pretty JSON.
- [ ] POST JSON to `/echo` echoes body and `Content-Type: application/json`.
- [ ] urlencoded and form-data (with a file) are parsed correctly by both servers.
- [ ] PUT, PATCH, DELETE, HEAD, OPTIONS all work; HEAD shows "No body".
- [ ] Query params added in the table appear in the URL, and vice versa; disabling a row removes it from the request.
- [ ] `/status/404` and `/status/500` display as responses, not errors.
- [ ] `/slow?ms=5000` with a 2 s timeout shows a timeout error; Cancel works mid-request.
- [ ] `/big?mb=30` shows the truncation notice and the UI stays responsive.
- [ ] `/bigint` displays `9007199254740993` exactly.
- [ ] `/html` previews sandboxed; `/image` renders; `/redirect` shows the final URL; `/sse` stops at timeout/cap; `/latin1` displays accents correctly.
- [ ] A dead port shows the network error card with hints.

**Resilience and safety**
- [ ] Reloading the extension while the page is open shows the reload message instead of hanging.
- [ ] Closing the page mid-request aborts it (verify with the slow endpoint's server log).
- [ ] An origin that is not in the allowed list cannot reach the extension.
- [ ] Reloading the page restores tabs and request state from IndexedDB; responses are not restored.
- [ ] Uninstalling or disabling the extension shows the banner; direct mode works against a server that sends CORS headers and fails with the CORS hint otherwise.
- [ ] Light and dark themes both render legibly.

---

## 12. Rules for the agent

- No backend, no analytics, no external network calls from the web app other than the user's own requests.
- Do not use `eval`, `new Function`, `innerHTML`, or `dangerouslySetInnerHTML`.
- Keep functions small and pure where possible; keep UI components free of protocol details (they call `sendRequest`).
- If something in this plan is impossible as written (e.g. a library API changed), choose the closest working alternative, note it in `README.md` under "Deviations", and continue.