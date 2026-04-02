# Product Requirements Document — MiraChat WeChat Gateway (`gateway-wechaty`)

| Field | Value |
| --- | --- |
| Product area | MiraChat channel adapter |
| Component | `MiraChat/apps/gateway-wechaty` |
| Document type | Adapter PRD |
| Status | Draft |
| Related docs | [PRD-MiraForU.md](./PRD-MiraForU.md), [system-design-proxy-self.md](./system-design-proxy-self.md) |

This PRD covers the use of **Wechaty** as the WeChat adapter boundary for MiraChat. The goal is not to make Wechaty the product. The product remains the **approval-first delegation runtime**; Wechaty is the transport-specific edge that connects personal WeChat events to the transport-neutral core.

---

## 1. Purpose

Provide a reliable WeChat gateway that:

- authenticates a user-controlled WeChat session
- converts inbound WeChat traffic into MiraChat's normalized event shape
- sends approved outbound drafts back through the same session
- keeps WeChat SDK details isolated from the core runtime

**Principle:** own policy and delegation in the core; outsource channel mechanics to the adapter.

---

## 2. Problem

MiraChat needs a way to participate in WeChat conversations without leaking WeChat-specific objects and behaviors into the core agent system.

Without a dedicated adapter:

- inbound WeChat messages cannot enter the shared approval and policy pipeline
- outbound drafts cannot be actuated back to the original WeChat thread
- channel-specific auth and session volatility would contaminate core logic
- the product could not test the WeChat wedge without over-coupling to one SDK

---

## 3. Users and Jobs To Be Done

### Primary user

The MiraChat operator who wants WeChat messages to flow through the same approval-first delegate experience as other channels.

### Jobs to be done

- Connect my WeChat account with minimal setup.
- See connection state and QR-based re-auth when required.
- Receive suggested or approved responses for WeChat threads inside MiraChat.
- Send approved replies back to the correct DM or group thread.

---

## 4. Product Goals

1. **Connect WeChat to MiraChat safely.**
   Use QR/session-based auth and expose connection state back to the control plane.
2. **Normalize messages into the shared event contract.**
   The rest of the system should consume `channel`, `threadId`, `senderId`, `text`, and related metadata without depending on Wechaty objects.
3. **Preserve approval-first behavior.**
   Outbound WeChat sends should come from approved drafts or explicit policy outcomes, not from direct autonomous bot logic in the gateway.
4. **Contain transport risk.**
   WeChat-specific instability, auth churn, and SDK changes must stay inside the adapter boundary.

---

## 5. Non-Goals

- Building product logic directly inside Wechaty event handlers
- Supporting every Wechaty surface in v1 (friendship, room invitations, media automation, plugins)
- Full autonomous outbound loops by default
- Making Wechaty the source of truth for user identity, policy, or memory

---

## 6. MVP Scope

### In scope

- start a Wechaty bot instance with configured name
- emit QR/auth-required state for login
- mark connection state as `ONLINE`, `OFFLINE`, or `AUTH_REQUIRED`
- receive inbound text messages from DMs and groups
- normalize room vs DM thread identity
- debounce bursts of inbound text before posting to MiraChat API
- poll approved drafts and send them back to the correct contact or room

### Out of scope for MVP

- rich media ingestion and send
- automated handling of friendship and room invitation flows
- multi-account orchestration in one process
- advanced retry queues, dedupe across restarts, and durable delivery receipts

---

## 7. User Experience Requirements

### 7.1 Connection and auth

- When login is required, the gateway must surface QR payload and mark status as `AUTH_REQUIRED`.
- When the session logs in successfully, the gateway must mark status as `ONLINE`.
- When the session logs out, the gateway must return to `AUTH_REQUIRED`.

### 7.2 Inbound message handling

- Ignore self-sent messages.
- Support both direct messages and room messages.
- For room messages, use room id as `threadId`.
- For direct messages, use talker id as `threadId`.
- Preserve `senderId` as the originating contact id.
- Only text is required in early versions.

### 7.3 Outbound message handling

- Only send messages that have already been approved or otherwise released by MiraChat policy.
- Send to a room when the thread maps to a room; otherwise send to the contact.
- Mark drafts as sent after successful actuation.

---

## 8. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | The gateway must instantiate a Wechaty session using environment-driven configuration. |
| FR-2 | The gateway must publish auth status updates to the MiraChat API. |
| FR-3 | The gateway must transform WeChat events into a transport-neutral payload for `/mirachat/inbound`. |
| FR-4 | The gateway must debounce inbound text bursts so short message sequences arrive as a single logical ingest unit. |
| FR-5 | The gateway must poll pending approved drafts and attempt delivery on a fixed interval. |
| FR-6 | The gateway must send outbound text to either `Room` or `Contact` based on the stored `threadId`. |
| FR-7 | The gateway must log send/ingest failures without crashing the process. |
| FR-8 | The gateway must remain usable in a local/demo mode when MiraChat API integration is disabled. |

---

## 9. Success Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Connection success rate | Share of login attempts reaching `ONLINE` after QR/auth flow | > 80% in controlled testing |
| Inbound normalization success | Share of inbound text events accepted by MiraChat API | > 95% |
| Approved-send success | Share of approved drafts successfully actuated to WeChat | > 95% |
| Time to reconnect | Logout/auth-required to restored `ONLINE` | < 3 minutes median |
| Policy containment | Share of outbound sends coming from approved/policy-cleared drafts | 100% |

---

## 10. Key Flows

### 10.1 Connect account

```text
Gateway starts -> Wechaty emits scan -> MiraChat receives QR/auth status ->
user authenticates -> Wechaty login event -> MiraChat marks connection ONLINE
```

### 10.2 Inbound message to draft

```text
WeChat inbound text -> gateway normalizes DM/group metadata ->
debounced POST to /mirachat/inbound -> core policy/agent flow ->
draft appears in approval system
```

### 10.3 Approved draft to sent message

```text
Approval granted in MiraChat -> gateway polls pending-send ->
resolve thread as Room or Contact -> send text via Wechaty ->
mark draft sent
```

---

## 11. Architecture Constraints

- `gateway-wechaty` is an edge adapter only.
- Core packages must not import Wechaty classes.
- WeChat-specific identifiers must be normalized before entering shared pipelines.
- Approval and policy decisions must remain outside the gateway process.
- Failures in auth or sending must degrade the WeChat channel, not the whole product architecture.

---

## 12. Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Session instability | QR/session auth may expire or break operator trust | Explicit connection states, fast re-auth loop, adapter isolation |
| SDK/platform volatility | WeChat transport rules can shift | Keep all Wechaty usage inside one gateway app |
| Wrong-thread sends | High trust and social-risk failure mode | Use normalized room/contact resolution, approval-first default, send logging |
| Burst message fragmentation | Users often send multiple short messages in sequence | Debounce inbound text into one ingest unit |
| Over-automation | Channel feels personal and high-risk | Default to review/approval; do not let gateway invent policy |

---

## 13. Rollout Plan

### Phase 1

- single operator
- local or controlled environment
- text-only
- approval-first only

### Phase 2

- better observability around auth state, send failures, and reconnect cycles
- durable delivery bookkeeping
- clearer operator UI for WeChat connection health

### Phase 3

- selective low-risk automation if policy engine explicitly authorizes it
- media and richer event coverage only after text path is stable

---

## 14. Open Questions

- Which Wechaty puppet/runtime will be the supported default for production-like testing?
- How should long-lived session secrets be stored and rotated across environments?
- Should approved-send polling remain interval-based or move to a push/event model later?
- What operator-facing recovery UX is needed when QR auth is repeatedly required?

---

## 15. Decision Summary

Use **Wechaty** as the WeChat transport adapter for MiraChat because it lets the product validate a WeChat channel wedge while keeping the actual product moat elsewhere: **policy, memory, identity, and approval workflows**. The adapter should stay narrow, observable, and replaceable.
