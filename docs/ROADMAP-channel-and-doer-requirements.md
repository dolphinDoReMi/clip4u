# Roadmap — Channel And Doer Requirements

| Field | Value |
| --- | --- |
| Document type | Delivery roadmap + readiness checklist |
| Scope | Channel plugins, official surfaces, doer runtimes |
| Status | Draft |
| Related docs | [system-design-proxy-self.md](./system-design-proxy-self.md), [PRD-wechaty-gateway.md](./PRD-wechaty-gateway.md), [PRD-wecom-gateway.md](./PRD-wecom-gateway.md), [PRD-mini-program.md](./PRD-mini-program.md) |

This document answers a practical question: **what is required to move each surface from scaffold to real usage**?

It covers:

- `Wechaty`
- `OpenClaw`
- `WeCom`
- `Mini Program`
- adjacent channel surfaces already present in the repo (`Twilio`, `Telegram`, `WhatsApp`)

The goal is not to restate every PRD. The goal is to make delivery planning, setup, and sequencing obvious.

---

## 1. Core principle

All surfaces plug into the same core:

```text
Channel / Surface / Doer -> normalized contract -> dispatcher -> agent -> policy -> approval -> send or task
```

The core owns:

- identity
- memory
- policy
- approval
- audit

Each external surface owns only its edge behavior:

- auth / session / credentials
- callback or polling runtime
- upstream payload normalization
- upstream delivery semantics

---

## 2. Delivery Sequence

Recommended implementation and rollout order:

1. **Twilio / Telegram**
   Lowest integration ambiguity for real-world testing.
2. **WeCom**
   Preferred official WeChat-ecosystem business channel.
3. **Mini Program**
   Official user-facing WeChat-native control surface.
4. **OpenClaw**
   Optional doer runtime once approval and audit loops are solid.
5. **Wechaty**
   Research / MVP / operator-controlled use only; highest platform risk.

Reason:

- official or managed channels should come before unofficial session automation
- user-control surfaces should come before aggressive autonomy
- doers should come after draft approval, audit, and outbound safety are stable

---

## 3. Common Requirements

Every surface needs these foundations first:

### Product-core requirements

- stable `MessageEvent` normalization
- working policy engine
- approval workflow
- audit trail
- outbound draft persistence
- connection status model

### Infra requirements

- reachable `MiraChat` API
- PostgreSQL configured and migrated
- `.env` populated for the target surface
- logs visible for gateway and API processes

### Operational requirements

- explicit owner for each surface
- clear policy on what is allowed to auto-send
- retry / failure handling strategy
- live-test checklist before pilot rollout

---

## 4. Status Matrix

| Surface | Repo status | Real-test readiness | Risk profile | Primary use |
| --- | --- | --- | --- | --- |
| `Twilio` | Implemented | High once credentials/webhooks exist | Low to medium | SMS / WhatsApp Business |
| `Telegram` | Implemented | High once bot token/webhook exist | Low to medium | Bot-based messaging |
| `WeCom` | Scaffold + official outbound path | Medium; needs real enterprise credentials + callback setup | Medium | Official enterprise WeChat path |
| `Mini Program` | API + client scaffold | Medium; needs real AppID/App Secret + DevTools/client run | Medium | Official in-WeChat user surface |
| `OpenClaw` | Integrated as optional doer | Medium; needs runtime install and bounded task policy | Medium to high | Approved task execution |
| `Wechaty` | Implemented | Medium technically, low operationally | High | Personal WeChat runtime / experiments |
| `WhatsApp web.js` | Implemented | Medium technically, lower policy confidence than Twilio | High | Unofficial WhatsApp MVP path |

---

## 5. Surface Requirements

## 5.1 `Wechaty`

### What it is

Unofficial personal WeChat runtime used as an adapter boundary.

### Repo status

- gateway exists
- QR auth state is persisted
- inbound normalization works
- approved outbound send path works
- live QR/auth flow was verified locally

### Required for real usage

- a working WeChat session that is not blocked by upstream anti-abuse controls
- operator able to scan QR codes repeatedly when needed
- `MIRACHAT_API_URL`
- `WECHAT_ACCOUNT_ID`
- `WECHATY_NAME`
- optional debounce / poll tuning

### External dependencies

- WeChat session acceptance by upstream
- runtime stability of the chosen Wechaty path / puppet

### Main blockers

- session churn
- account flagging or bans
- unofficial API volatility

### Recommendation

Treat `Wechaty` as:

- experimental
- operator-controlled
- non-core to long-term product strategy

Do not make it the primary channel for a legitimate business rollout.

---

## 5.2 `OpenClaw`

### What it is

An optional **doer runtime** for approved task execution, not a channel.

### Repo status

- doer package exists in `packages/openclaw-doer`
- API routes exist for status and execution
- approval flows can hand off to OpenClaw
- tests cover bounded doer execution paths

### Required for real usage

- installed and working `OpenClaw` runtime at the configured path
- supported Node runtime for the doer wrapper
- one of:
  - `agentId`
  - `sessionId`
  - `to`
- explicit task policy and audit expectations

### Key env / config

- `MIRACHAT_OPENCLAW_DIR`
- `MIRACHAT_OPENCLAW_ENTRY`
- `MIRACHAT_OPENCLAW_NODE_BIN`
- optional defaults:
  - `MIRACHAT_OPENCLAW_AGENT_ID`
  - `MIRACHAT_OPENCLAW_SESSION_ID`
  - `MIRACHAT_OPENCLAW_TO`
  - `MIRACHAT_OPENCLAW_TIMEOUT_SECONDS`

### Main blockers

- unclear approval boundaries for task execution
- runtime availability on production hosts
- safe allowlists for what tasks can be delegated

### Recommendation

Use `OpenClaw` only after:

- approval actions are trusted
- audit trails are being reviewed
- doer tasks are narrowly bounded and reversible where possible

---

## 5.3 `WeCom`

### What it is

The preferred official business-grade channel in the WeChat ecosystem.

### Repo status

- gateway workspace exists
- callback verification + decrypt scaffold exists
- inbound normalization exists
- official outbound external-contact text send path exists
- smoke-test script exists

### Required for real usage

- `WECOM_CORP_ID`
- `WECOM_CORP_SECRET`
- `WECOM_TOKEN`
- `WECOM_ENCODING_AES_KEY`
- `WECOM_AGENT_ID`
- `WECOM_ACCOUNT_ID`
- a public callback URL for `WECOM_WEBHOOK_PATH`

### External dependencies

- enterprise WeCom admin access
- correct app configuration in WeCom admin
- allowed message scope for the chosen app and external-contact model

### Main blockers

- org setup complexity
- callback reachability from the public internet
- final choice of supported WeCom send model

### Recommendation

Make `WeCom` the default long-term path for:

- enterprise messaging
- customer or partner communication under official controls
- China-market business use cases that need legitimacy

---

## 5.4 `Mini Program`

### What it is

An official in-WeChat user-facing control surface, not a transport adapter.

### Repo status

- backend login/bootstrap/assist/action routes exist
- signed session-token flow exists
- first client scaffold exists in `apps/mini-program`
- draft review page exists

### Required for real usage

- `MINI_PROGRAM_APP_ID`
- `MINI_PROGRAM_APP_SECRET`
- `MINI_PROGRAM_SESSION_SECRET`
- real Mini Program AppID in `project.config.json`
- reachable API base for the client
- WeChat DevTools or device run to generate real `wx.login()` codes

### External dependencies

- WeChat DevTools
- official Mini Program project setup
- account-linking decision between `openid`/`unionid` and `userId`

### Main blockers

- final account-linking model
- production API reachability from the Mini Program client
- notification / re-entry strategy

### Recommendation

Use `Mini Program` as the official user-control layer for:

- approvals
- summaries
- assist workflows
- connection health visibility

It should complement `WeCom`, not replace it.

---

## 5.5 `Twilio`

### What it is

Managed CPaaS for SMS and WhatsApp Business.

### Repo status

- gateway exists
- webhook validation exists
- outbound send path exists
- smoke-test path exists

### Required for real usage

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- sender configuration
- public webhook base when signature validation is enabled

### Recommendation

This is the best operational baseline for real messaging tests before pushing harder into WeChat-specific surfaces.

---

## 5.6 `Telegram`

### What it is

Official bot API adapter.

### Repo status

- gateway exists
- webhook and polling support exist
- outbound send path exists

### Required for real usage

- `TELEGRAM_BOT_TOKEN`
- webhook setup or polling
- reachable API

### Recommendation

Use for low-friction real-world testing of the approval and draft-send loop.

---

## 6. Readiness Levels

Use these labels consistently:

### `Scaffolded`

- repo structure exists
- core routes or gateway skeleton exists
- tests may be mocked

### `Credential-ready`

- env vars documented
- runtime can start
- required external configuration is known

### `Live-test ready`

- public callback or client path can be exercised
- credentials available
- send / receive path can be verified end to end

### `Pilot ready`

- operator runbook exists
- failure modes are understood
- audit and support ownership are defined

---

## 7. Real-Test Checklists

## 7.1 `Wechaty`

- API reachable
- gateway running
- QR flow visible
- account accepted by WeChat
- inbound message lands in draft queue
- approved outbound send reaches target thread

## 7.2 `OpenClaw`

- OpenClaw runtime path valid
- Node runtime compatible
- selector configured (`agentId` or `sessionId` or `to`)
- doer status endpoint passes
- approved task execution returns structured JSON
- audit events recorded

## 7.3 `WeCom`

- API running
- gateway running
- public callback URL reachable
- GET callback verification succeeds
- POST callback decrypt succeeds
- inbound message is normalized into MiraChat
- approved draft sends through official endpoint

## 7.4 `Mini Program`

- API running with Mini Program credentials
- client opened in WeChat DevTools
- `wx.login()` succeeds
- `/mini-program/login` returns session token
- `/mini-program/bootstrap` returns drafts and status
- approve / reject / edit / select-option work from the client

---

## 8. Recommended Ownership

| Area | Owner |
| --- | --- |
| Core policy / approval / audit | Product + platform engineering |
| Managed channels (`Twilio`, `Telegram`) | Platform / integrations |
| Official WeChat ecosystem (`WeCom`, `Mini Program`) | Platform / China-market owner |
| `Wechaty` | Experimental / R&D owner only |
| `OpenClaw` | Agent/runtime owner with policy review |

---

## 9. Recommended 30-60-90 Sequence

### Next 30 days

- harden `Twilio` and `Telegram` for repeatable real tests
- complete first live `WeCom` credentialed callback test
- finalize Mini Program account-linking model

### Next 60 days

- run end-to-end `Mini Program` client test in DevTools
- validate official `WeCom` outbound send in a real tenant
- formalize `OpenClaw` allowed-task policy

### Next 90 days

- decide whether `Wechaty` stays research-only or remains a maintained edge path
- move official WeChat strategy toward `WeCom` + `Mini Program`
- define pilot readiness criteria per surface

---

## 10. Decision Summary

If the goal is **legitimate, durable product delivery**, the center of gravity should be:

- `Twilio` / `Telegram` for fast real-world validation
- `WeCom` for official WeChat-ecosystem business messaging
- `Mini Program` for official in-WeChat user control
- `OpenClaw` for bounded approved tasks

`Wechaty` should remain the most cautious path: useful for learning and narrow operator use, but not the strategic default.
