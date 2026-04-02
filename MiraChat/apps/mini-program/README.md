# MiraChat Mini Program

This is the first WeChat Mini Program client scaffold for MiraChat.

## What it does

- logs in through `wx.login()` + `POST /mini-program/login`
- stores the signed MiraChat session token locally
- **Gateway picker** — choose WeChat, WhatsApp (Twilio), Telegram, or WeCom; refreshes `GET /mini-program/bootstrap?channel=&accountId=` so you see the matching `user_connections` row and **your** pending drafts (same `userId` as the session).
- loads `GET /mini-program/bootstrap`
- runs `POST /mini-program/assist` (passes selected `channel` / `accountId` for memory context)
- supports pending draft actions:
  - approve
  - reject
  - edit and approve
  - select reply option

## Open in WeChat DevTools

1. Open the `apps/mini-program` folder in WeChat DevTools.
2. Replace the placeholder `appid` in `project.config.json` with your Mini Program AppID.
3. Point `App.globalData.apiBase` in `app.js` to a reachable MiraChat API.
4. Ensure the API has:
   - `MINI_PROGRAM_APP_ID`
   - `MINI_PROGRAM_APP_SECRET`
   - `MINI_PROGRAM_SESSION_SECRET`

## Notes

- The current scaffold defaults to `demo-user` for account linking.
- The backend remains the source of truth for approvals, policy, and memory.
- This package uses plain Mini Program files instead of a framework wrapper.
- For a **browser** client with the same API, use `apps/web-client` and `MINI_PROGRAM_DEV_LOGIN=1` on the API.
