# Delegate AI

Delegate AI is a product monorepo scaffold for a controlled delegation runtime.

## Included

- `apps/gateway-whatsapp`: WhatsApp adapter boundary
- `apps/gateway-wechaty`: WeChat adapter boundary
- `apps/gateway-wecom`: WeCom adapter boundary
- `apps/gateway-telegram`: Telegram adapter boundary
- `apps/mini-program`: WeChat Mini Program client scaffold
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

### CI

The strict PRD/GQM validation workflow lives in `.github/workflows/mirachat-prd-gqm.yml`.
It requires the secret `MIRACHAT_CI_DATABASE_URL` and executes:

```bash
npm run test:prd
```

If the secret is unavailable, the workflow reports that the real acceptance suite was skipped instead of failing with a vague configuration error.

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
