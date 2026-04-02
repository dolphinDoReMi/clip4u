# Product Requirements Document — MiraForU (Proxy Self)

| Field | Value |
| --- | --- |
| Codename | MiraForU |
| Product | Proxy Self — AI Communication Delegate |
| Document type | One-pager + system mapping (investor & internal alignment) |
| Status | Draft |
| Companion | [Product GQM — goals, questions, metrics](product-GQM-MiraForU.md) · [System design — plugins & layers](system-design-proxy-self.md) · [Design audit — WhatsApp function, IG look](design-audit-proxy-self-ig-ui.md) |

Proxy Self is a **bounded delegate**, not merely a faster writer: it acts on the user’s behalf within explicit guardrails. This PRD is tuned for **early investor conversations** and **engineering alignment**—with explicit treatment of **defensibility**, **cold start**, and **GTM wedge**. **Messaging** is implemented as **pluggable channel plugins** (Wechaty, Telegram Bot API, whatsapp-web.js, Twilio CPaaS, future Gmail/Slack/email, …). **Approved execution** beyond a single chat send uses **pluggable doer plugins** (OpenClaw as the reference runtime). The **owned moat** is identity, policy, memory, and delegation control—not any one SDK.

---

## How this draft was sharpened

- **Wedge (red ocean):** “Scheduling & coordination” alone competes with Motion, Calendly AI, Clara, Clockwise, etc. The differentiated story is **high-context coordination driven by the Identity Model**—negotiation and prioritization by **relationship weight** (e.g. board member now, vendor next week), not only calendar whitespace.
- **Cold start:** The `UserModel` is only a moat if it **bootstraps without heavy manual setup**. The plan must include **data ingestion** (e.g. OAuth to Gmail / Slack—or comparable sources—with consent) to **pre-compute embeddings and initial tone/rules**, not 50-field forms on Day 1.
- **Measurable trust:** North stars like “&lt;1% regret events” are hard to observe. **Proxy metrics** include **approval rate without edits**, **time-to-auto-mode** (trust velocity for bounded autonomy), and **time-to-first-good-draft** after ingestion.
- **Long-term vision:** Lean into an **async coordination economy**—**agent-to-agent** negotiation where one user’s Proxy coordinates with another’s, over a future **protocol layer**.

---

## 1. Product vision

Build a **persistent, bounded** AI agent that represents the user in **multi-channel** communication loops. Proxy Self **preserves intent**, manages routine interactions, and **reduces cognitive load**, bridging the gap between an AI writing assistant and a fully autonomous agent.

**Core principle:** *Protect user intent; delegate the execution.*

### Product experience direction

The product should **behave like WhatsApp** and **look like Instagram DM**.

- **Behavior:** inbox-first, thread-centric messaging, persistent composer, mobile-first chat navigation, inline approval in the active conversation.
- **Visual language:** dark premium surfaces, pink-orange-purple accents, rounded controls, story-ring identity cues, and a cleaner DM-like feel than a generic admin console.
- **Design rule:** trust and delegation affordances must feel native to chat, not bolted on as back-office tooling.

### Design principle (architecture)

**Own decision-making; plug transport and execution.** **Channel plugins** normalize inbound/outbound chat into one internal contract; **doer plugins** run bounded tasks after policy and approval. The **core** owns dispatcher, agent, policy, identity, memory, and audit.

| Layer | Role | Implementation |
| --- | --- | --- |
| **Channel plugins** | Messaging I/O only | Pluggable gateways: WeChat (Wechaty), WhatsApp (web.js or Twilio WA), Telegram (Bot API), Twilio SMS/Conversations, …; later Gmail, Slack, email as additional plugin ids |
| **Core (owned)** | Moat | Dispatcher, Agent Core, Policy Engine, Identity + Memory, approval + audit |
| **Doer plugins** (optional) | Approved non-chat execution | Pluggable runtimes; **OpenClaw** is the reference **doer**—swappable without forking core |

Canonical diagrams and registry patterns: [system-design-proxy-self.md](system-design-proxy-self.md) (Sections 4–6, 8–9).

---

## 2. The problem

High-output professionals suffer from **communication fragmentation** and **decision fatigue**.

- **The gap:** Tools that optimize **speed of writing** (e.g. Grammarly-class, Superhuman-class) do not reliably capture **intent**, **cross-thread context**, or **relationship dynamics** across platforms.
- **The pain:** Users burn time **context-switching**, **calibrating tone**, and executing **low-leverage coordination** (scheduling, follow-ups, standard declines) instead of deep work.

### Problem → system mapping

| Problem | System component |
| --- | --- |
| Fragmented communication | **Channel plugins** → normalized `MessageEvent` |
| Cognitive overhead | Assist mode (summaries, multi-option drafts) |
| Inconsistent voice | Identity + relationship model |
| Fatigue | Delegation modes + policy (approve / auto within bounds) |

---

## 3. Target audience

- **Primary:** Founders, executives, and operators (high-leverage, time-poor).
- **Secondary:** High-volume relationship managers (sales, investors, recruiters).

### Architectural implications

- **Multi-user** tenancy and isolated policy per user.
- **Multi-thread** concurrency and safe outbound queuing.
- **Cross-channel** identity: one logical contact/relationship graph across adapters.

---

## 4. Product scope (evolution)

| Stage | Positioning | Capabilities |
| --- | --- | --- |
| **MVP (v1)** | **The contextual drafter** | Ingest historical data (with consent) to **bootstrap voice**. Multi-channel **thread summarization**, **multi-option replies** (e.g. concise vs relationship-preserving). **Draft → Approve → Send** only. |
| **v1.5** | **Bounded delegation** | Structured rule-sets; **auto follow-ups**; **soft-negotiation scheduling** (multi-party constraints informed by **relationship priority**, not just free slots). |
| **v2** | **The proxy agent** | **Partial auto-reply** inside hard guardrails. **Persistent, cross-platform relationship memory** and merged context. |

### Feature → implementation (v1 detail)

| Feature | System mapping |
| --- | --- |
| Thread summarization | Context engine: `buildContext(event) → { history, semanticRecall }` |
| Multi-option replies | Agent Core: `generateReplies(context, modes: ['concise','assertive','warm'])` |
| Draft → approve → send | Policy Engine + queue: if `!safe` → `queueForApproval()` |
| Tone per relationship | `relationship.tone` → `context.identity` / `context.relationship` in prompts |

---

## 5. Core technical pillars (the moat)

### A. Identity and intent model

A **dynamic, personalized** profile—not generic “assistant voice.” **Cold start** is addressed by **analyzing historical email/Slack (and similar)** under user consent to seed the schema; manual tuning is optional refinement, not a prerequisite.

```ts
UserModel = {
  toneEmbedding,
  decisionRules,
  preferenceGraph,
  relationshipMemory,
  riskConstraints,
}
```

### B. Context and memory engine

**Cross-channel** aggregation that tracks **relationship trajectory**, not only the current thread: prior interactions, role of counterparty, and channel-spanning context. **Backing store (illustrative):** Postgres + pgvector; tables such as `messages(user_id, thread_id, content, embedding, …)`, `relationships(user_id, contact_id, tone, role, …)`.

### C. Communication engine

**Agent Core:** planner → executor → evaluator. Negotiation as **tools** (e.g. `scheduleNegotiator`, `constraintResolver`).

### D. Delegation and trust layer (non-negotiable)

- **Graduated autonomy:** Assist (suggest) → Approve (draft) → Auto (execute only inside boundaries).
- **Hard constraints:** Immutable rules (e.g. **no financial commitments**, no irreversible decisions without explicit human approval).
- **Transparency and reversibility:** Audit logs (“action taken because of rule X”); rollback/undo where the channel supports it.

**Policy examples:** `financial_commitment` → **BLOCK**; `low_confidence` → **REVIEW**. Default mode: **APPROVE**; **AUTO** only via explicit policy.

### E. Channel plugins (integration pattern)

Each surface is a **channel plugin**: it maps native SDK/webhook payloads to a transport-neutral **`MessageEvent`**, and sends **`OutboundCommand`** back through a **channel registry** (core never imports Wechaty, Telegram, Twilio, or WhatsApp types).

```text
[ wechat | whatsapp | telegram | twilio_* | … ]  ← channel plugin ids
      ↓
normalize → MessageEvent
      ↓
Core: Dispatcher → Agent → Policy → (Approve | Auto-send)
      ↓
OutboundCommand → same or other channel plugin → user’s thread
```

**Rules:** plugins own session health and vendor ids (`threadId`, `senderId`, `accountId` mapping); core owns policy and trust. Add Gmail/Slack/email by registering new channel ids—same contracts.

### F. Doer plugins (OpenClaw as reference)

To move from “delegate that drafts” to “delegate that gets work done,” approved work can be handed to a **doer plugin** via a **doer registry** (`doerId`, e.g. `openclaw`). OpenClaw is the **reference implementation**, not a hard dependency in core.

- **MiraForU / Proxy Self still owns:** identity, context assembly, policy, approval, audit, and whether a task may run.
- **Doer plugin owns:** bounded execution (tools, browser, external agent session) **after** handoff—under timeout and allowlists defined in **`ApprovedDoerTask`** (or equivalent).
- **Boundary:** narrow API (task spec, correlation ids, delivery controls). Doer must **not** be source of truth for identity, relationship policy, or approval state.
- **Moat:** trust logic stays in core; execution stacks swap. Aligns with [system-design-proxy-self.md §4.2, §9.5](system-design-proxy-self.md).

---

## 6. Go-to-market and wedge strategy

| Phase | Wedge | Differentiation |
| --- | --- | --- |
| **1** | **High-context coordination** | Not “find a slot”—**negotiate using UserModel**: e.g. defer vendor, prioritize board; relationship-weighted scheduling. |
| **2** | **Unified inbox proxy** | Email and Slack (native integrations/adapters): routine approvals, status updates, polite declines—same identity and policy layer. |
| **3** | **Agent-to-agent protocol** | Proxies negotiate with other Proxies—**async coordination layer**; long-term structural moat. |

**Integration sequencing (risk):** Prefer **standard OAuth** (e.g. Gmail) where possible before the most **fragmented or unofficial channel plugins** (WhatsApp/WeChat); keep plugins isolated so compliant and unofficial paths can coexist behind the same core contracts.

---

## 7. Key success metrics (PMF and trust signals)

Full **Goal–Question–Metric** breakdown, targets, experiments, and cross-system metrics: [product-GQM-MiraForU.md](product-GQM-MiraForU.md).

| Metric | Definition | Direction |
| --- | --- | --- |
| **Time-to-value** | Historical ingestion → first **accurate** draft | Target: **&lt; 5 minutes** |
| **Trust (proxy)** | **% of drafts approved without edits** | Target: **&gt; 70%** |
| **Delegation velocity** | Time for user to move a recurring contact **Approve → Auto** | Decrease over cohorts |
| **Efficiency** | **≥ 30%** reduction in average thread resolution time | Increase |
| **Regret (aspirational)** | User-reported “should not have sent” / serious harm | Drive toward **&lt; 1%**; instrument with surveys and support tags |

**Instrumentation:** Log at dispatcher, policy branches, and approval outcomes (e.g. `logEvent({ type: 'AUTO_SEND', confidence, userId, policyRuleId, … })`).

---

## 8. Key user flows (system execution)

**Assisted reply:** message in → `ASSIST` → suggestions / drafts → user sends.

**Delegated scheduling (v1.5+):** message in → delegate mode → scheduling tool → policy → approve → send.

**Auto (v2, policy-gated):** message in → policy allows `AUTO` → generate → send immediately.

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Hallucinations / social or professional harm** | Strict bounding in early versions; **deterministic rule overlays** on LLM output; default approve; block high-stakes classes. |
| **Cross-platform integration friction** | OAuth-first where stable; **channel plugin** isolation; unofficial clients in dedicated gateway processes; session restart/backoff. |
| **Over-automation** | Default **APPROVE**; AUTO is explicit per rule/contact. |
| **Latency** | Fast paths where safe; async approval queue for outbound. |
| **Platform instability (unofficial APIs)** | Wechaty/WhatsApp confined to **channel plugins**; never entangle with core policy/memory. |

---

## 10. Non-goals

- Autonomous conversation loops **without** policy boundaries.
- Fully agent-driven threads **with no** human checkpoint in v1.
- Positioning scheduling as **“calendar whitespace only”** without **relationship-aware** prioritization (weakens defensibility).

---

## 11. Competitive differentiation (summary)

| Dimension | Moat |
| --- | --- |
| Identity | Explicit user + relationship model; **ingestion-backed** cold start |
| Memory | Cross-channel, durable; trajectory, not one-thread |
| Delegation | Policy engine + graduated autonomy + audit |
| Coordination | **Relationship-priority** negotiation vs generic schedulers |
| Future | **Agent-to-agent** protocol and negotiation engine |

---

## 12. Long-term vision

**Today:** `Channel plugins → Core (Dispatcher → Agent → Policy) → Send (+ optional Doer plugins)`

**Future:** Proxy ↔ Proxy over a **protocol layer** and **negotiation engine**—an async coordination economy.

---

## 13. Synthesis

The product is the **control layer**: identity, policy, delegation logic, and memory—not any single transport or execution stack. **Channel plugins** maximize leverage on chat/CPaaS/email surfaces; **doer plugins** (e.g. OpenClaw) handle approved action without owning trust; **core** owns the brain and the trust loop.

---

## 14. Next steps (pick one)

1. **Data:** `UserModel` + relationship graph **schema** and **pipeline** for historical context ingestion (OAuth, embedding jobs, PII boundaries).
2. **Narrative:** **GTM and fundraising** storyboard (wedge slides, moat, cold-start demo path).
3. **Build:** Runnable **Node + TypeScript** reference: multi-user, dispatcher, policy stubs, one OAuth source + one **channel plugin** + one **doer plugin** (OpenClaw reference) behind thin registry APIs.

---

## Document history

| Version | Date | Notes |
| --- | --- | --- |
| 0.1 | 2026-03-31 | Initial PRD from system-mapped outline |
| 0.2 | 2026-03-31 | Investor/alignment pass: wedge, cold start, PMF metrics, GTM phases, agent-to-agent vision |
| 0.3 | 2026-03-31 | Companion GQM doc: [product-GQM-MiraForU.md](product-GQM-MiraForU.md); §7 cross-link |
| 0.4 | 2026-04-02 | Added `OpenClaw` doer-runtime boundary: MiraForU owns policy/trust, external runtime executes approved tasks |
| 0.5 | 2026-04-02 | Aligned §1 architecture table and §E–F with **pluggable channel plugins** + **pluggable doer plugins**; cross-link [system-design-proxy-self.md](system-design-proxy-self.md) |
