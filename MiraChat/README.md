# Delegate AI

Delegate AI is a product monorepo scaffold for a controlled delegation runtime.

## Included

- `apps/gateway-whatsapp`: WhatsApp adapter boundary
- `apps/gateway-wechaty`: WeChat adapter boundary
- `apps/gateway-wecom`: WeCom adapter boundary
- `apps/gateway-telegram`: Telegram adapter boundary
- `apps/mini-program`: WeChat Mini Program client scaffold (multi-gateway picker: WeChat / WhatsApp / Telegram / WeCom)
- `apps/web-client`: browser client for the same `/mini-program/*` flows (requires `MINI_PROGRAM_DEV_LOGIN=1` for token mint)
- `apps/ops-console`: lightweight approval console scaffold
- `services/api`: approval and health API scaffold
- `packages/*`: transport-neutral core packages

## Principles

- Channel SDKs stay in gateway apps only.
- Core packages are transport-agnostic.
- Approval-first behavior is the default.
- The initial deployment targets a lean single Node service plus Postgres.

## Quick Start

```bash
npm install
npm run build
npm test
```

### Database (local PostgreSQL)

Use the PostgreSQL service already running on your machine. Configure `DATABASE_URL` in `.env`, then apply schema:

```bash
npm run mirachat:migrate
```

If your role cannot `CREATE DATABASE`, create it once (`createdb mirachat` or via `psql`) and set `MIRACHAT_SKIP_ENSURE_DATABASE=1`.

PRD/GQM validation: see [../docs/prd-gqm-e2e-test-suite.md](../docs/prd-gqm-e2e-test-suite.md).

### Real UI E2E (Playwright — no mocks)

Requires PostgreSQL with `pgvector` via your existing local or external service and a valid `DATABASE_URL` in `.env`.

```bash
npx playwright install chromium   # once
npm run test:prd
```

This is the real PRD/GQM acceptance path:

- no mocks
- no Docker dependency in the test design
- real DB pipeline + real browser UI

Use `npm run test:fast` for quick mocked/unit feedback during development.
If Playwright's dedicated E2E ports `4400` / `4473` are already in use by a correctly configured stack, opt into reuse with `PW_REUSE_SERVERS=1 npm run test:e2e`.

### WeChat desktop E2E (nut.js)

Optional **native desktop** automation for the **WeChat client** (not Wechaty, not the mini program) uses **`@nut-tree-fork/nut-js`** and is **off by default**.

**Who can “control the desktop”?** nut.js drives the **same machine and session** as the shell that runs it. On Linux, if `DISPLAY` / `WAYLAND_DISPLAY` are unset, `scripts/ensure-linux-display.mjs` (loaded by `desktop:check`, `wechat:reply`, `whatsapp:reply`) tries an **X11 socket in `/tmp/.X11-unix` owned by your user** (e.g. `:1`). Headless CI still has no sockets; remote SSH often still needs X forwarding or a local terminal. Run `npm run desktop:check` — if it lists windows, reply scripts can run too.

- **Send a reply** from the desktop client: `npm run wechat:reply -- --message "Your text"` (optional `-c "ContactName"` for Ctrl/Cmd+F search). Same prerequisites as below.
- **WhatsApp Desktop (default):** `npm run whatsapp:reply -- --contact "tennis group" --message "I am ok"` — **`scripts/whatsapp-desktop-send.mjs`**. On **Wayland**, it uses **`wtype`** if installed (`sudo apt install wtype`): you get a countdown, then **click WhatsApp** so it’s focused; keys go to the desktop app, not the browser. On **X11**, it uses **nut.js** to find a window titled like WhatsApp. Override: `--backend wtype` or `--backend nut`, or env `WHATSAPP_INPUT_BACKEND`.
- **Cursor / agent → desktop (so the agent can send again):** In a **normal Terminal window on your desktop** (not headless SSH), run `sudo apt install wtype` once, then `npm run whatsapp:bridge` and leave it running. It listens on **`http://127.0.0.1:9742`**. From anywhere on the same machine (including Cursor’s terminal), run `npm run whatsapp:remote -- -c "tennis group" -m "I am ok"` — or `curl -X POST http://127.0.0.1:9742/send -H 'Content-Type: application/json' -d '{"contact":"tennis group","message":"I am ok"}'`. During the default 8s wait, **focus WhatsApp**. On **X11**, the bridge now checks the **active window** before typing and fails fast if it does not look like WhatsApp; inspect it with `curl http://127.0.0.1:9742/health`. If WhatsApp exposes an odd class/title, pass `--focused-window-regex 'whatsapp|electron'` to `whatsapp:remote`, or set `WHATSAPP_FOCUSED_WINDOW_REGEX`. Optional: `MIRACHAT_WHATSAPP_BRIDGE_TOKEN` + header `X-MiraChat-Token`.
- **Legacy nut-only script:** `node scripts/whatsapp-reply-nut.mjs` (e.g. `--no-focus`); prefer `whatsapp:reply` above.
- **WhatsApp Web (optional):** `npm run whatsapp:web-send -- --contact "…" --message "…"` if you explicitly want the browser client.
- Run smoke / window enumeration: `WECHAT_DESKTOP_E2E=1 npm run test:wechat-desktop`
- Full flow (focus WeChat, optional Ctrl+F contact search, type message): set `WECHAT_DESKTOP_FULL=1` and see env vars in `tests/e2e/wechat-desktop-nut.e2e.spec.ts`
- Requires a **graphical session** (`DISPLAY` on Linux). Headless servers will see X11 warnings; the native addon must still load.
- **Linux arm64:** `@nut-tree-fork/libnut-linux` ships an x86-64 binary; `npm install` runs `scripts/ensure-libnut-linux-native.mjs` to build or restore an **arm64** `libnut.node` (cached under `~/.cache/mirachat-libnut/`). Needs `git`, `cmake`, `g++`, and libnut’s X11 dev packages. Retry after clearing cache: `npm run rebuild:libnut`. In CI (`CI=true`), that step is skipped unless `MIRACHAT_LIBNUT_REBUILD_IN_CI=1`.

### CI

The workflow `.github/workflows/mirachat-prd-gqm.yml` runs two jobs:

1. **Supporting tests** — always runs `npm run test:fast` (no secrets; runs on fork PRs too).
2. **Real PRD/GQM validation** — requires the secret `MIRACHAT_CI_DATABASE_URL` and runs `npm run test:prd`.

If the secret is unavailable, the real job reports that the acceptance suite was skipped instead of failing with a vague configuration error; the supporting job still validates mocked/unit coverage.

### Twilio Smoke Test

With the API running and Twilio env vars configured in `.env`, run:

```bash
npm run test:twilio
```

Set `TWILIO_TEST_TO` to a verified recipient address that is different from the configured sender. For WhatsApp, use `whatsapp:+E164`.

### WeCom smoke test

With the API and WeCom gateway running, plus credentials in `.env`, run:

```bash
npm run test:wecom
```

The script checks:

- API health
- WeCom gateway health
- current MiraChat `wecom` connection row
- official `gettoken` success when `WECOM_CORP_ID` and `WECOM_CORP_SECRET` are set

### Telegram gateway

The Telegram adapter lives in `apps/gateway-telegram` and uses `telegraf` with either:

- the default Telegram cloud Bot API
- a self-hosted `tdlib/telegram-bot-api` server via `TELEGRAM_BOT_API_ROOT`

Minimum env vars:

```bash
MIRACHAT_API_URL=http://127.0.0.1:4000
MIRACHAT_USER_ID=demo-user
TELEGRAM_BOT_TOKEN=
TELEGRAM_ACCOUNT_ID=telegram-bot
TELEGRAM_GATEWAY_PORT=4020
TELEGRAM_POLL_MS=5000
TELEGRAM_WEBHOOK_PATH=/webhooks/telegram/message
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_BOT_API_ROOT=https://api.telegram.org
```

Run it with:

```bash
npm run dev:api
npm run dev:telegram
```

Useful endpoints:

- `GET /health`
- `GET /telegram/webhook-info`
- `POST /telegram/register-webhook`

Adapter PRD: [../docs/PRD-telegram-gateway.md](../docs/PRD-telegram-gateway.md).

### WeCom gateway

The WeCom adapter lives in `apps/gateway-wecom` and provides:

- official callback verification and decrypt scaffold
- normalized inbound routing into MiraChat
- optional pending-send hook via `WECOM_OUTBOUND_ENDPOINT`

Minimum env vars:

```bash
MIRACHAT_API_URL=http://127.0.0.1:4000
MIRACHAT_USER_ID=demo-user
WECOM_ACCOUNT_ID=wecom-app
WECOM_GATEWAY_PORT=4030
WECOM_WEBHOOK_PATH=/webhooks/wecom/message
WECOM_CORP_ID=
WECOM_CORP_SECRET=
WECOM_TOKEN=
WECOM_ENCODING_AES_KEY=
WECOM_AGENT_ID=
WECOM_OUTBOUND_ENDPOINT=
```

If `WECOM_CORP_SECRET` and `WECOM_AGENT_ID` are set, the gateway can send approved drafts through the official WeCom external-contact text API. `WECOM_OUTBOUND_ENDPOINT` remains available as an override hook.

Run it with:

```bash
npm run dev:api
npm run dev:wecom
```

Useful endpoints:

- `GET /health`
- `GET /webhooks/wecom/message`
- `POST /webhooks/wecom/message`

Adapter PRD: [../docs/PRD-wecom-gateway.md](../docs/PRD-wecom-gateway.md).

### Mini Program API surface

The first Mini Program surface is scaffolded in `services/api` with:

- `POST /mini-program/login`
- `GET /mini-program/bootstrap`
- `POST /mini-program/assist`
- `POST /mini-program/drafts/:id/approve`
- `POST /mini-program/drafts/:id/reject`
- `POST /mini-program/drafts/:id/edit`
- `POST /mini-program/drafts/:id/select-option`

Minimum env vars:

```bash
MINI_PROGRAM_APP_ID=
MINI_PROGRAM_APP_SECRET=
MINI_PROGRAM_SESSION_SECRET=
MINI_PROGRAM_SESSION_TTL_SECONDS=43200
```

`/mini-program/bootstrap`, `/mini-program/assist`, and the draft action routes require a valid bearer session token returned by `/mini-program/login`.

Surface PRD: [../docs/PRD-mini-program.md](../docs/PRD-mini-program.md).

### Mini Program client

The first client scaffold lives in `apps/mini-program`.

It includes:

- `wx.login()` bootstrap against `/mini-program/login`
- inbox/bootstrap page
- draft review page
- assist call
- mobile wrappers for the pending-draft actions

Build verification:

```bash
npm run build --workspace @delegate-ai/mini-program
```

Open the folder in WeChat DevTools and follow `apps/mini-program/README.md`.
