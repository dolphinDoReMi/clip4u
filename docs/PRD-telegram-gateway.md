# Product Requirements Document — MiraChat Telegram Gateway (`gateway-telegram`)

| Field | Value |
| --- | --- |
| Product area | MiraChat channel adapter |
| Component | `MiraChat/apps/gateway-telegram` |
| Document type | Adapter PRD |
| Status | Draft |
| Related docs | [PRD-MiraForU.md](./PRD-MiraForU.md), [system-design-proxy-self.md](./system-design-proxy-self.md) |

This PRD covers the use of **Telegraf** plus the **Telegram Bot API** as the Telegram adapter boundary for MiraChat. The goal is not to make Telegram transport logic the product. The product remains the **approval-first delegation runtime**; Telegram is the transport-specific edge that connects bot updates to the transport-neutral core.

---

## 1. Purpose

Provide a reliable Telegram gateway that:

- authenticates a bot token against Telegram
- converts inbound Telegram traffic into MiraChat's normalized event shape
- sends approved outbound drafts back through the same bot
- keeps Telegram SDK and Bot API details isolated from the core runtime

**Principle:** own policy and delegation in the core; outsource channel mechanics to the adapter.

---

## 2. Problem

MiraChat needs a way to participate in Telegram conversations without leaking Telegram-specific webhook, SDK, or Bot API objects into the core agent system.

Without a dedicated adapter:

- inbound Telegram messages cannot enter the shared approval and policy pipeline
- approved drafts cannot be actuated back to the original Telegram chat
- webhook secrets, bot auth, and Bot API server configuration would contaminate core logic
- the product could not test a Telegram wedge without over-coupling to one transport client

---

## 3. Users and Jobs To Be Done

### Primary user

The MiraChat operator who wants Telegram messages to flow through the same approval-first delegate experience as other channels.

### Jobs to be done

- Connect my Telegram bot with minimal setup.
- See whether the bot token and webhook are healthy.
- Receive suggested or approved responses for Telegram threads inside MiraChat.
- Send approved replies back to the correct Telegram DM or group thread.

---

## 4. Product Goals

1. **Connect Telegram to MiraChat safely.**
   Use bot-token auth, optional webhook-secret validation, and expose connection state back to the control plane.
2. **Normalize messages into the shared event contract.**
   The rest of the system should consume `channel`, `threadId`, `senderId`, `text`, and related metadata without depending on Telegram SDK objects.
3. **Preserve approval-first behavior.**
   Outbound Telegram sends should come from approved drafts or explicit policy outcomes, not from direct autonomous bot logic in the gateway.
4. **Contain transport risk.**
   Telegram SDK changes, webhook concerns, and Bot API server choices must stay inside the adapter boundary.

---

## 5. Non-Goals

- Building product logic directly inside Telegraf middleware
- Supporting every Telegram surface in v1 (inline queries, callback buttons, files, stickers, polls)
- Full autonomous outbound loops by default
- Making Telegram the source of truth for user identity, policy, or memory

---

## 6. MVP Scope

### In scope

- start a Telegraf bot with environment-driven configuration
- support cloud Bot API and self-hosted `tdlib/telegram-bot-api` via configurable `apiRoot`
- validate optional webhook secret headers
- mark connection state as `ONLINE` or `OFFLINE`
- receive inbound text messages from DMs and groups
- normalize private vs group thread identity
- poll approved drafts and send them back to the correct Telegram chat
- expose lightweight health and webhook-info routes for operator debugging

### Out of scope for MVP

- rich media ingestion and send
- inline keyboard flows and callback queries
- command-specific business logic
- advanced retry queues, dedupe across restarts, and durable delivery receipts

---

## 7. User Experience Requirements

### 7.1 Connection and auth

- When the bot token is valid, the gateway must mark status as `ONLINE`.
- When token validation or Bot API connectivity fails, the gateway must mark status as `OFFLINE`.
- When `TELEGRAM_WEBHOOK_URL` is configured, the gateway should be able to register the webhook automatically or via a control endpoint.

### 7.2 Inbound message handling

- Ignore bot-originated updates.
- Support both direct messages and group/supergroup messages.
- For group messages, use `chat.id` as `threadId`.
- For direct messages, use the private `chat.id` as `threadId`.
- Preserve `senderId` as the originating Telegram user id.
- Only text/caption text is required in early versions.

### 7.3 Outbound message handling

- Only send messages that have already been approved or otherwise released by MiraChat policy.
- Send outbound text to the stored Telegram `chat.id`.
- Mark drafts as sent after successful actuation.

---

## 8. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | The gateway must instantiate a Telegraf session using environment-driven configuration. |
| FR-2 | The gateway must support overriding the Telegram Bot API root for self-hosted `tdlib/telegram-bot-api`. |
| FR-3 | The gateway must validate the `x-telegram-bot-api-secret-token` header when a webhook secret is configured. |
| FR-4 | The gateway must transform Telegram updates into a transport-neutral payload for `/mirachat/inbound`. |
| FR-5 | The gateway must poll pending approved drafts and attempt delivery on a fixed interval. |
| FR-6 | The gateway must send outbound text using `chat.id` as the normalized thread target. |
| FR-7 | The gateway must log send/ingest failures without crashing the process. |
| FR-8 | The gateway must expose basic operator endpoints for health and webhook inspection. |

---

## 9. Success Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Bot connectivity success | Share of starts reaching `ONLINE` with valid token/API root | > 95% in controlled testing |
| Inbound normalization success | Share of inbound text updates accepted by MiraChat API | > 95% |
| Approved-send success | Share of approved drafts successfully actuated to Telegram | > 95% |
| Webhook setup success | Share of configured environments where webhook registration succeeds | > 90% |
| Policy containment | Share of outbound sends coming from approved/policy-cleared drafts | 100% |

---

## 10. Key Flows

### 10.1 Connect bot

```text
Gateway starts -> Telegraf validates token -> optional webhook registration ->
MiraChat marks connection ONLINE
```

### 10.2 Inbound message to draft

```text
Telegram inbound update -> gateway normalizes DM/group metadata ->
POST to /mirachat/inbound -> core policy/agent flow ->
draft appears in approval system
```

### 10.3 Approved draft to sent message

```text
Approval granted in MiraChat -> gateway polls pending-send ->
send text via Telegram Bot API -> mark draft sent
```

---

## 11. Architecture Constraints

- `gateway-telegram` is an edge adapter only.
- Core packages must not import Telegraf or Telegram Bot API types.
- Telegram-specific identifiers must be normalized before entering shared pipelines.
- Approval and policy decisions must remain outside the gateway process.
- Failures in webhook or send handling must degrade the Telegram channel, not the whole product architecture.

---

## 12. Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Wrong-thread sends | High trust and social-risk failure mode | Normalize around `chat.id`, approval-first default, send logging |
| Bot token misconfiguration | Gateway appears healthy but cannot deliver | Boot-time `getMe()` check and explicit `OFFLINE` state |
| Webhook drift | Telegram keeps sending to stale URL | Expose webhook-info endpoint and optional re-registration route |
| Self-hosted Bot API mismatch | Local `tdlib/telegram-bot-api` can differ from cloud setup | Keep `apiRoot` configurable and isolate transport specifics in the gateway |
| Over-automation | Personal and group contexts are high-trust surfaces | Default to review/approval; do not let gateway invent policy |

---

## 13. Rollout Plan

### Phase 1

- single bot / single operator
- text-only
- approval-first only
- webhook-first deployment

### Phase 2

- better observability around webhook health, send failures, and Bot API server status
- durable delivery bookkeeping
- clearer operator UI for Telegram connection health

### Phase 3

- richer Telegram surfaces after text path is stable
- selective low-risk automation if policy engine explicitly authorizes it

---

## 14. Open Questions

- Should Telegram webhook registration stay manual in production, or should the gateway remain authoritative for re-registration?
- What operator-facing recovery UX is needed when bot token rotation occurs?
- Should command handling live in the gateway or remain fully normalized through core routing?
- When media support arrives, which file-size and storage path should be the default for cloud vs self-hosted Bot API?

---

## 15. Decision Summary

Use **Telegraf** with the **Telegram Bot API** as the Telegram transport adapter for MiraChat because it lets the product validate a Telegram channel wedge while keeping the actual product moat elsewhere: **policy, memory, identity, and approval workflows**. The adapter should stay narrow, observable, and replaceable.
