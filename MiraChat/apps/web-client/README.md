# MiraChat web client

Browser UI that uses the same **mini-program API** (`/mini-program/*`) as the WeChat Mini Program: bootstrap, assist, and draft approve / reject / edit / option pick.

## What it is not

- It does **not** embed the WeChat / WhatsApp / Telegram apps. Real traffic still flows through **gateway** services (`apps/gateway-wechaty`, `gateway-twilio`, `gateway-telegram`, etc.) into the API.
- The **Gateway** dropdown only changes which `channel` + `accountId` are sent to `GET /mini-program/bootstrap` (connection row + user-scoped drafts/threads).

## Run locally

1. PostgreSQL + `DATABASE_URL` in `MiraChat/.env`, API running (`npm run dev:api`).
2. Enable dev tokens (required for browser login):

   ```bash
   MINI_PROGRAM_DEV_LOGIN=1
   ```

   in `.env`, then restart the API.

3. Build and serve the static app:

   ```bash
   npm run dev --workspace @delegate-ai/web-client
   ```

   Opens on **http://127.0.0.1:4480** by default.

4. Open the UI, set API base if needed, choose **Gateway** (WeChat / WhatsApp / Telegram / WeCom), click **Dev login**.

## Production

- WeChat users should use **`apps/mini-program`** with `wx.login` → `POST /mini-program/login`.
- A future production web auth (OIDC, magic link, etc.) can issue the same bearer session format without `MINI_PROGRAM_DEV_LOGIN`.
