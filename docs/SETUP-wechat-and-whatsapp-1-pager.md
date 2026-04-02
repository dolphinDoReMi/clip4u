# WeChat + WhatsApp Local Setup · 1-Pager

| Field | Value |
| --- | --- |
| Document type | Practical setup one-pager |
| Scope | Local development and one-off sending |
| Status | Working notes based on verified local runs |

This repo currently has two practical local messaging paths:

- **WeChat**: run directly from the root `wechaty` codebase.
- **WhatsApp**: use the existing `MiraChat/apps/gateway-whatsapp` path, which is built on `whatsapp-web.js`.

This guide is intentionally biased toward the **fastest local path that worked** in this workspace, with **no Docker**.

---

## 1. What works today

| Channel | Runtime path | Auth model | Verified outcome |
| --- | --- | --- | --- |
| WeChat | root `wechaty` repo | QR scan | login, read messages, send room/contact message |
| WhatsApp | `MiraChat` + `whatsapp-web.js` | QR scan | QR bootstrapped locally; one-off sender and list-chats scripts |

---

## 2. Environment assumptions

- OS: Linux
- Shell: `bash`
- Node: `v18.x` worked in this workspace
- Docker: **not required**
- Browser for WhatsApp: local Chromium worked better than the bundled Puppeteer browser

---

## 3. WeChat Setup

### 3.1 Install enough dependencies

The root `wechaty` repo has a heavy contributor dependency graph. The fastest local bootstrap was:

```bash
npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline --package-lock=false
npm install --prefix "$HOME/.local" ts-node typescript
```

Why:

- runtime packages come from the root repo
- `ts-node` and `typescript` are installed into a user-writable prefix to avoid global permission issues

### 3.2 Use the checked-in WeChat helper

Use the helper script instead of the long inline command:

```bash
./scripts/wechaty-local.sh watch --bot mirachat-wechat
```

Expected behavior:

- prints a QR login URL
- after scan, prints `LOGIN <name>`
- continues logging live incoming messages

### 3.3 One-off send example

Send to a room:

```bash
./scripts/wechaty-local.sh send \
  --bot mirachat-wechat \
  --room "Super Tennis🎾2群" \
  --text "厉害了"
```

Send to a contact:

```bash
./scripts/wechaty-local.sh send \
  --bot mirachat-wechat \
  --contact "Jarvis" \
  --text "hello"
```

Verified in this workspace:

- room lookup succeeded
- message send succeeded

---

## 4. WeChat Caveats

### 4.1 Default memory-card persistence was unreliable

The default `*.memory-card.json` file in the repo root ended up empty during session churn. The checked-in helper now avoids that by:

- using a dedicated file-backed session under `~/.config/wechaty/`
- preloading the `MemoryCard` before boot
- using a process lock per bot name

### 4.2 Do not compete for the same session file

Running:

- one long-lived message logger
- plus a second one-off script

caused conflicts around the memory-card session state. The helper script now enforces a lock, so only one WeChat process can use a given bot name at a time.

### 4.3 `swc` is not the safe default here

Inherited config from `@chatie/tsconfig` uses:

```json
"transpiler": "ts-node/transpilers/swc-experimental"
```

That failed locally because the native `@swc/core` binding was not usable in the partial install state. The helper script forces plain TypeScript transpilation instead.

---

## 5. WhatsApp Setup

### 5.1 Use the `MiraChat` workspace

The practical WhatsApp path in this repo is:

- `MiraChat/apps/gateway-whatsapp`
- package: `whatsapp-web.js`

This is cleaner than trying to force a WhatsApp puppet into the root Wechaty bootstrap flow.

### 5.2 Prerequisites

From `MiraChat/`:

```bash
npm install
```

In this workspace, the dependencies were already present.

### 5.3 Use system Chromium, not the bundled browser

The bundled Puppeteer browser failed locally with an architecture/binary mismatch. The working fix was to point Puppeteer at the system Chromium:

- `/usr/bin/chromium-browser`

### 5.4 Use the checked-in WhatsApp sender

Use:

```bash
./MiraChat/scripts/whatsapp-send-once.sh \
  --target "Jarvis" \
  --text "hello Jarvis"
```

Expected behavior:

- boot Chromium headlessly
- print a WhatsApp QR URL
- after scan, resolve `Jarvis`
- send `hello Jarvis`
- exit

### 5.5 List chats (names and IDs)

Uses the same `LocalAuth` session as the sender (`--session` default `cursor-whatsapp-send`), so you usually do not need to scan again after the sender has logged in once.

```bash
./MiraChat/scripts/whatsapp-list-chats.sh
```

Optional flags:

- `--limit N` — only print the first *N* chats after sorting by name (default: all)
- `--json` — print a JSON array of `{ name, id, isGroup }`
- `--session` / `--browser` — same as the sender

Each line is tab-separated: `group|dm`, display name, serialized chat id.

---

## 6. WhatsApp Caveats

### 6.1 Import style

`whatsapp-web.js` is CommonJS in this setup, so use:

```js
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
```

not named ESM imports.

### 6.2 Bundled Chromium can fail

Observed failure:

- Puppeteer tried to launch a downloaded Chrome binary
- the binary failed immediately with a shell syntax error

Using system Chromium fixed that. The checked-in sender and `MiraChat` gateway now prefer:

- `CHROME_BIN`
- `/usr/bin/chromium-browser`
- `/snap/bin/chromium`
- `/usr/bin/chromium`

### 6.3 QR can take a while to appear

Even with Chromium running, WhatsApp Web can stay quiet for a short period before emitting the QR event. Give it some startup time before assuming it is hung.

---

## 7. Recommended Next Step

The repo now includes:

- `scripts/wechaty-local.sh`
- `scripts/wechaty-local.mjs`
- `MiraChat/scripts/whatsapp-send-once.sh`
- `MiraChat/scripts/whatsapp-send-once.mjs`
- `MiraChat/scripts/whatsapp-list-chats.sh`
- `MiraChat/scripts/whatsapp-list-chats.mjs`

These replace the earlier ad hoc inline commands and encode the known-good local setup.
