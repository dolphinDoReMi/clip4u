# Phone calls via OpenClaw — feature design (draft)

| Field | Value |
| --- | --- |
| Status | Draft (design); P1 outbound notify implemented in MiraChat |
| Scope | OpenClaw orchestration + external telecom; optional MiraChat handoff |
| Related | OpenClaw `docs/plugins/voice-call.md` (voice-call plugin), [system-design-proxy-self.md](system-design-proxy-self.md), doer runtime boundary in [PRD-MiraForU.md](PRD-MiraForU.md) |

---

## 1. Executive summary

**Short answer:** phone calls are feasible in theory and in practice, but **not as a built-in “dial the PSTN” primitive** inside OpenClaw alone. OpenClaw is an **agent orchestrator**; placing a call requires **delegation to a telecom-capable backend** (or a fragile device bridge).

**Bottom line:**

- OpenClaw **can** orchestrate outbound (and, with webhooks, interactive) phone calls.
- It **cannot** today place calls through carrier networks **without** integration work: a **telecom API** (e.g. Twilio, Vonage), **or** a **local device bridge**, **or** (mostly blocked) messaging-platform voice APIs.
- Product framing should default to **“calling on behalf of the user”** (delegation), not **“calling as the user”** (impersonation), for trust, legal, and adoption reasons.

---

## 2. What OpenClaw can and cannot do

### 2.1 What it can do

- Act as an **agent orchestrator** (reasoning, planning, tool calling).
- Integrate with **external APIs** via **plugins and tools**.
- Trigger **side effects** such as messaging, scheduling, HTTP actions, and—when wired—**voice sessions** through a provider.

### 2.2 What it does not do out of the box

- **Directly** originate calls on the PSTN without a connected provider.
- **Autonomously** open the **native dialer** on iOS/Android in a reliable, policy-safe way.

**Implication:** OpenClaw does not “call” in the telecom sense by itself; it **delegates** calling to a **connected service** (plugin + provider).

### 2.3 Reference implementation path (OpenClaw ecosystem)

OpenClaw ships a **voice-call plugin** pattern (documented as `voice-call`): providers such as **Twilio**, **Telnyx**, **Plivo**, plus **mock** for development. Configuration lives under gateway/plugin config; CLI surface includes `openclaw voicecall` when the plugin is installed and enabled.

This document’s **Option A** aligns with that plugin model: **Agent → call tool / plugin → provider API → PSTN**.

---

## 3. Realistic architectures

### Option A — Telecom API (recommended for production)

**Examples:** Twilio Programmable Voice, Vonage Voice API, Telnyx, Plivo.

**Flow:**

```text
OpenClaw agent
  → Call tool / voice-call plugin
  → Provider REST + webhooks (signaling + media or gather/IVR)
  → PSTN
  → Human answers
```

**Typical capabilities:**

- Outbound calls; inbound with published webhook URL.
- **TTS** (and optionally **streaming** / media) for agent-spoken content.
- **IVR / gather** flows for structured input.
- **Recording and transcription** (provider-native or post-call ASR).

**Why this is the default path:** stable contracts, observable failures, compliance hooks (consent, disclosure), and operability at scale.

---

### Option B — Personal device bridge (prototype / personal use)

**Flow:**

```text
OpenClaw
  → Local bridge (Mac / iPhone / Android)
  → OS dialer or FaceTime / relay
  → Call
```

**Examples of “hacks”:**

- macOS: AppleScript / Shortcuts triggering Phone or FaceTime.
- Android: intents or automation (high permission surface).
- iOS: **severely constrained** for background, non-jailbroken automation.

**Drawbacks:** permission friction, reliability, security review, and (for App Store–distributed clients) **policy risk**.

**Use when:** one-off demos or strictly **local, user-initiated** flows—not the core product architecture.

---

### Option C — Messaging-platform “voice”

**Examples:** WhatsApp Business API, WeChat.

**Reality:**

- **WhatsApp Business API** does not offer a general, automatable **outbound voice call** API comparable to Twilio-style PSTN control for most product use cases.
- **WeChat** is a closed ecosystem; **no** stable third-party “place a WeChat voice call” API for arbitrary automation.

**Conclusion:** treat this path as **mostly blocked** for “OpenClaw places a voice call” unless the product explicitly lives inside a platform that exposes voice (rare for automation).

---

## 4. Product decision: “as you” vs “for you”

Two fundamentally different products:

| Mode | Pitch | Risk / fit |
| --- | --- | --- |
| **A. Agent calls as YOU** | AI speaks with your full personal identity | High **trust** and **legal** risk; social friction (“deepfake” perception); hard to scale |
| **B. Agent calls FOR you** | “Hi, I’m calling on behalf of [Name]…” | Clear **delegation**; fits **scheduling**, **reservations**, **vendor / CS** triage |

**Recommendation:** default product and copy to **B**. Reserve **A** for narrow, explicit, consent-heavy flows if ever offered.

---

## 5. Production reference architecture (minimal)

```text
[OpenClaw agent]
        ↓
[Call capability — plugin / tool]
        ↓
[Telecom voice API — e.g. Twilio]
        ↓
[TTS + (optional) LLM turn loop + ASR]
        ↓
[Human on phone]
```

**Common add-ons:**

- **ASR** (e.g. Whisper or provider streaming) for barge-in and turn-taking.
- **State machine** or explicit **conversation policy** (max duration, escalation, handoff).
- **Memory / preferences** (who to call, quiet hours, language).

**Webhook exposure:** Twilio-class providers require a **public HTTPS URL** for status and gather callbacks; local dev typically uses **ngrok**, **Tailscale Funnel/Serve**, or a fixed reverse proxy. The OpenClaw voice-call plugin documents `publicUrl`, `serve`, and tunnel options.

---

## 6. Integration with MiraChat (optional boundary)

If MiraChat (or MiraForU) **approves** a task that includes “place a call,” the same **doer boundary** as OpenClaw execution applies:

- **MiraChat owns:** policy, approval, audit, identity context, and **whether** a call may be attempted.
- **OpenClaw + voice plugin owns:** execution against the telecom provider within that bounded task (to number, script/disclosure mode, max duration, recording flags).

Handoff payload should be **narrow**: callee, purpose, disclosure template (“on behalf of”), provider profile id, **no** storage of raw auth tokens in MiraChat if avoidable (use env / gateway-side config).

---

## 7. Constraints and non-goals

| Area | Constraint |
| --- | --- |
| **Legal / compliance** | Some jurisdictions require **disclosure** or **consent** for AI-generated or recorded voice; align with counsel before GA. |
| **Trust** | Undisclosed “human-like” agents erode trust; prefer explicit delegation wording. |
| **Latency** | Interactive voice wants **sub-second** perceived turn latency; budget for streaming ASR/TTS and regional placement. |
| **Cost** | Per-minute telecom + LLM + TTS + optional transcription; need caps and preflight estimates. |
| **Security** | Webhook signature verification, replay protection, and secret rotation for provider credentials. |

**Non-goals (for v1):** replacing emergency services; unsolicited cold-call campaigns at scale; impersonation of third parties without consent.

---

## 8. Phased delivery (suggested)

| Phase | Outcome |
| --- | --- |
| **P0 — Design** | Lock **Option B** copy; choose provider; define consent/disclosure; define Mira handoff fields (if any). |
| **P1 — Outbound notify** | Single outbound call with fixed or TTS message; webhook reliability; basic metrics and failure codes. |
| **P2 — Simple conversation** | Gather or streaming loop with bounded turns; max duration; hangup and escalate paths. |
| **P3 — Product hardening** | Rate limits, allowlists for destinations, audit export, cost dashboards, regional routing. |

---

## 9. Open questions

- **Provider:** Twilio vs Telnyx vs Plivo (existing org accounts, number inventory, compliance).
- **Inbound vs outbound-only** for v1.
- **Recording default:** on/off; retention; PII in transcripts.
- **MiraChat:** is the call **always** operator-approved, or are there auto-send-class policies for low-risk templates?

---

## 10. Document history

| Version | Date | Notes |
| --- | --- | --- |
| 0.1 | 2026-04-02 | Initial draft from design outline; aligned with OpenClaw voice-call plugin model and Mira doer boundary |
| 0.2 | 2026-04-02 | MiraChat P1 outbound notify: API routes, Twilio package, ops-console UI, delegation events |

---

## 11. Implementation (v1 — MiraChat outbound notify)

**Scope:** Option A-style outbound **notify** call from the MiraChat API using Twilio Programmable Voice (TTS `<Say>`). OpenClaw is not required for this path; it satisfies the **delegation-first** copy and **MiraChat audit** boundary described above.

### 11.1 Package

- **`@delegate-ai/twilio-voice-notify`** (`MiraChat/packages/twilio-voice-notify/`): `buildNotifyTwiml()`, `placeOutboundNotifyCall()`, `resolveTwilioVoiceConfigFromEnv()`.

### 11.2 API (MiraChat `services/api`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/mirachat/phone/status` | `{ configured, fromMasked, outboundSecretRequired, provider }` |
| `POST` | `/mirachat/phone/outbound` | Place outbound notify call (JSON body below) |

**`POST /mirachat/phone/outbound` body:** `userId`, `to` (E.164), `message` (≤2000 chars), optional `disclosureMode` (`on_behalf` \| `neutral`), `callerName`, `threadId`, `channel`, `accountId`.

**Optional gate:** if `MIRACHAT_PHONE_OUTBOUND_SECRET` is set, clients must send header **`X-Mirachat-Phone-Secret`** with the same value.

### 11.3 Environment variables

| Variable | Notes |
| --- | --- |
| `MIRACHAT_TWILIO_ACCOUNT_SID` or `TWILIO_ACCOUNT_SID` | Twilio account |
| `MIRACHAT_TWILIO_AUTH_TOKEN` or `TWILIO_AUTH_TOKEN` | Twilio auth |
| `MIRACHAT_TWILIO_VOICE_FROM` or `TWILIO_VOICE_FROM_NUMBER` | Caller ID (E.164) |
| `MIRACHAT_PHONE_OUTBOUND_SECRET` | Optional shared secret for outbound endpoint |
| `MIRACHAT_PUBLIC_BASE_URL` or `MIRACHAT_API_PUBLIC_URL` | Public **HTTPS** origin only (no path). If set, outbound calls use `StatusCallback` → `/mirachat/webhooks/twilio/voice-call-status` so Twilio can POST **StirVerstat** and disposition fields. |
| `MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK` | Optional full URL override for that webhook (else derived from public base). |
| `MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE` | Set to `1` **local dev only** to skip `X-Twilio-Signature` verification when using tunnel tools. |

### 11.4 Delegation audit events (`packages/db`)

Logged for observability: `phone.call.requested`, `phone.call.placed`, `phone.call.failed`, and **`phone.twilio.call_status`** for each Twilio Voice **status callback** (when configured), including **`StirVerstat`** when Twilio sends it.

### 11.5 Ops console

Connection drawer includes **Twilio voice notify** fields and **Place voice call (Twilio)** — `POST` to `/mirachat/phone/outbound` with optional secret header.

### 11.6 No ring / SIP 603 (phone + Trust Hub)

Twilio may show **SIP 603** (decline) on the carrier leg; that is resolved on the **handset / AT&T** and/or **Twilio Trust** (especially **SHAKEN/STIR**). **CNAM** (caller name) is often **not** available per individual local number—see **[twilio-voice-atnt-trust-setup.md](twilio-voice-atnt-trust-setup.md)**. Run `npm run twilio:trust-urls` from `MiraChat/` for Console links.

### 11.7 Voice status webhook (STIR / SHAKEN telemetry)

Twilio can POST call lifecycle events (including outbound **StirVerstat**) to **`POST /mirachat/webhooks/twilio/voice-call-status`**. The API verifies **`X-Twilio-Signature`** using **`MIRACHAT_PUBLIC_BASE_URL`** + request path (same rules as other Twilio webhooks). Events are stored as **`phone.twilio.call_status`** in `delegation_events.metadata` (`CallStatus`, `StirVerstat`, `SipResponseCode`, etc.). Requires **PostgreSQL** (route is behind the same `mirachat` gate as other `/mirachat/*` APIs). See **[twilio-voice-atnt-trust-setup.md](twilio-voice-atnt-trust-setup.md)**.
