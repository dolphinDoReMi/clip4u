# Product Requirements Document — MiraForU (Proxy Self)

| Field | Value |
| --- | --- |
| Codename | MiraForU |
| Product | Proxy Self — AI Communication Delegate |
| Document type | One-pager + system mapping (investor & internal alignment) |
| Status | Draft |
| Companion | [Product GQM — goals, questions, metrics](product-GQM-MiraForU.md) · [System design — plugins & layers](system-design-proxy-self.md) · [Design audit — WhatsApp function, IG look](design-audit-proxy-self-ig-ui.md) |

Proxy Self is a **bounded delegate**, not merely a faster writer: it acts on the user’s behalf within explicit guardrails. This PRD is tuned for **early investor conversations** and **engineering alignment**—with explicit treatment of **defensibility**, **cold start**, and **GTM wedge**. **Messaging** operates in an **Assist & Approve** paradigm: the system generates drafts that the user approves and manually transports to their chat app of choice. **Approved execution** beyond a single chat send uses **pluggable doer plugins** (OpenClaw as the reference runtime). The **owned moat** is identity, policy, memory, and delegation control—not any one SDK.

---

## How this draft was sharpened

- **Wedge (red ocean):** “Scheduling & coordination” alone competes with Motion, Calendly AI, Clara, Clockwise, etc. The differentiated story is **high-context coordination driven by the Identity Model**—negotiation and prioritization by **relationship weight** (e.g. board member now, vendor next week), not only calendar whitespace.
- **Cold start:** The `UserModel` is only a moat if it **bootstraps without heavy manual setup**. The plan must include **data ingestion** (e.g. OAuth to Gmail / Slack—or comparable sources—with consent) to **pre-compute embeddings and initial tone/rules**, not 50-field forms on Day 1.
- **Measurable trust:** North stars like “&lt;1% regret events” are hard to observe. **Proxy metrics** include **copied rate without edits** and **time-to-first-good-draft** after ingestion.
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
| **Channel plugins** | Messaging I/O only | Pluggable gateways for manual or semi-manual transport (e.g. Telegram Bot API, Twilio SMS/Conversations, …); direct integration to WhatsApp/WeChat is not supported in the current phase |
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
| **v2** | **The proxy agent** | **Persistent, cross-platform relationship memory** and merged context. |

### Feature → implementation (v1 detail)

| Feature | System mapping |
| --- | --- |
| Thread summarization | Context engine: `buildContext(event) → { history, semanticRecall }` |
| Full-text search (DMs + memory) | Postgres FTS on inbound / sent outbound / `memory_chunks`; API `GET /mirachat/search`; ops console sidebar hits |
| Multi-option replies | Agent Core: `generateReplies(context, modes: ['concise','assertive','warm'])` |
| Tenant isolation (API) | Optional `MIRACHAT_TENANT_ENFORCE` + bearer map / HMAC; ops console **Tenant bearer token**; thread history filtered by `user_id` when scoped |
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

**The Commitment Ledger:** Memory is not just a search index; it is a timeline of state changes and promises. The system maintains a structured ledger of entities and events (`memory_entities`, `memory_events`) to understand *what we agreed to* and *when*.

**Attention-Based Retrieval:** To prevent context bloat and hallucination, the system filters the entire Commitment Ledger against the current inbound message using an Attention LLM. This extracts only the strictly relevant facts needed for the current turn, creating an **Attended Ledger**.

**Full-text multimodal search (implemented in MiraChat):** User-scoped search spans **inbound** message bodies, **sent outbound** drafts, and **`memory_chunks`** — the same store used for **desktop / screenshot ingest** (OCR text, window metadata, optional vision summaries). Search is **lexical** (Postgres `tsvector` / `plainto_tsquery` with `simple` text config, GIN indexes, ranked by `ts_rank_cd`), not embedding KNN; it therefore finds words and phrases in any text that was persisted, including **derived text from multimodal capture**, not raw image bytes. The **ops console** sidebar combines **thread-list filtering** (id, display name, preview) with **debounced message search** via `GET /mirachat/search`, optional **“only open chat”** scoping, and hit badges (**DM** / **Sent** / **Context**). The cognitive pipeline continues to call `MemoryService.searchMessages` for cross-thread recall on each inbound assist.

#### B.1 Memory system strategy (priorities)

Memory is a **first-class moat**: generic “chat logs + vectors” is not enough. The product **prioritizes** three layers, in order—each layer informs retrieval, prompts, and what gets written after every user turn (including **multimodal** input: text, voice-as-text, screenshots/desktop-derived text, pasted images with captions, etc.).

| Priority | Layer | Product intent | What to persist and reason about |
| --- | --- | --- | --- |
| **1 — Specificity (entities)** | **Resolved world + people in the user’s life** | Every user signal should tighten **who and what** the proxy is talking about—not paraphrase soup. | **Identify and remember entities** per user: **contacts** and counterparties (link to `relationships` / `contacts` when known), **public or celebrity figures** the user names (as *their* reference, not public KB advertising), **organizations, products, places**, **identifiable objects** (gifts, devices, documents, tickets), **characters** (fiction, games, personas the user cares about). Store **structured facts** (entity type, canonical label, optional external id, confidence, **provenance**: source message/modality/thread, time) **in addition to** lexical chunks and embeddings. |
| **2 — Sequential pattern** | **Order, recurrence, and stateful threads of life** | Delegation needs **“where we are in the story”**—follow-ups, commitments, habits—not only similarity search. | **Temporal and sequential structure**: explicit **timelines** (before/after), **multi-step flows** (“step 2 of onboarding,” “waiting on their reply”), **recurrence** (“every Monday standup,” “annual renewal”), and **last-known state** per entity or thread. Retrieval ranks and assembles context so the model can reason about **what happens next** and **what already happened** without contradicting prior turns. |
| **3 — User narrative** | **How the user represents themselves** | The proxy must speak and decide **as** the user’s chosen self-story, not as a generic assistant. | A **stable narrative layer**: values, goals, ongoing arcs (career, family, health, projects), boundaries, and “how I want to come across.” Distinct from a flat entity list: this is **summarized, user-aligned representation** (periodically distilled from conversation + explicit settings), **user-visible and correctable**, injected into identity/context **before** generation. Updates conservatively; conflicts surface for confirmation rather than silent overwrite. |

**Engineering strategy (concise)**

- **Write path:** On ingest (every multimodal user input), run **entity extraction + linking** (P1), **event/sequence extraction** where applicable (P2), and schedule or trigger **narrative reconciliation** on a cadence or high-signal turns (P3). Raw content still lands in `messages` / `memory_chunks` for audit and lexical search.
- **Read path:** **Hybrid retrieval**—structured entity lookup and “facts about X,” **sequence- and recency-aware** chunk ranking, plus a **short narrative profile** block in the identity slot. Do not rely on embedding KNN alone for P1 or P2.
- **Privacy and policy:** Entity memory inherits **tenant isolation** ([§5.H](#h-multitenant-isolation-and-private-uploads-mirachat-api)); **contact-linked** facts follow relationship policy; **sensitive narratives** (health, legal, family) stay behind the same approval and minimization rules as the rest of the core.
- **Success signals:** Precision/recall of **remembered entities** (user corrections as ground truth), usefulness of **time-ordered** context in follow-ups and scheduling, and **approval-without-edit** rate when narrative and entity layers are populated (see [§7](#7-key-success-metrics-pmf-and-trust-signals)).

Canonical implementation sketch: [system-design-proxy-self.md §14](system-design-proxy-self.md).

### C. Communication engine

**Agent Core:** planner → executor → evaluator. Negotiation as **tools** (e.g. `scheduleNegotiator`, `constraintResolver`).

### D. Delegation and trust layer (non-negotiable)

**Decoupled Policy Engine (Safety Firewall):** The system uses an "Actor-Critic" model. The Drafter (Actor) writes the message based on the Attended Ledger, but an independent Policy Engine (Critic) judges it against Hard Constraints to prevent people-pleasing and boundary violations.

- **Graduated autonomy:** Assist (suggest) → Approve (draft). Safe autonomy (Auto-send) is not possible as of now due to lack of direct integration.
- **Hard constraints:** Immutable rules (e.g. **no financial commitments**, no irreversible decisions without explicit human approval).
- **Transparency and reversibility:** Audit logs (“action taken because of rule X”); rollback/undo where the channel supports it.

**Policy examples:** `financial_commitment` → **BLOCK**; `low_confidence` → **REVIEW**. Default mode: **APPROVE**; **AUTO** only via explicit policy.

### E. Channel plugins (integration pattern)

Each surface is a **channel plugin**: it maps native SDK/webhook payloads to a transport-neutral **`MessageEvent`**, and sends **`OutboundCommand`** back through a **channel registry** (core never imports Telegram or Twilio types).

```text
[ telegram | twilio_* | … ]  ← channel plugin ids
      ↓
normalize → MessageEvent
      ↓
Core: Dispatcher → Agent → Policy → (Approve)
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

### G. Desktop computer use (nut.js) and browser automation

**Capability:** optional **doer-side** automation that complements **channel plugins**. There is no single JavaScript stack for “full computer use”; product and engineering should treat it as **layered composition** under the same **policy + approval + audit** boundary as other doers.

| Layer | What it controls | Typical JS stack | Proxy Self role |
| --- | --- | --- | --- |
| **Browser (lower risk)** | Web UIs only | **Playwright** (cross-browser, agent-friendly), **Puppeteer** (Chrome-first, fast MVP) | Safe path for internal tools |
| **Desktop (medium)** | Mouse, keyboard, native windows | **[nut.js](https://nutjs.dev/)** — npm: **`@nut-tree-fork/nut-js`** (maintained fork; move, type, image/screen matching)—RPA class with AutoHotkey / Sikuli. Linux arm64: MiraChat **postinstall** can compile [libnut-core](https://github.com/nut-tree/libnut-core) when the prebuilt x64 `.node` does not match the host. | **Approved** tasks only: e.g. typing into a **native desktop client** when no official API exists |
| **Vision / screen understanding (hard)** | Semantic state of arbitrary UIs | OCR, screenshots + VLM, custom matchers | Optional; pairs with nut.js when coordinates or selectors are unstable |

**Product framing**

- **MVP stack (fast):** browser channels via **Puppeteer** or **Playwright**; **desktop hack channels** (e.g. WeChat desktop) via **nut.js** behind the **doer** boundary—not inside core or channel plugins.
- **Production-oriented stack:** **Playwright** for web reliability; **nut.js** plus optional vision/OCR; **event queue, retries, and idempotency** around every desktop action (focus loss, DPI, OS updates break naive scripts).
- **MCP + browser bridges** (e.g. Puppeteer MCP servers) are useful for **LLM → structured browser tools**; they **do not** replace desktop control—desktop remains **explicit doer tooling**.

**Non-claims:** No dependency in MiraChat core on nut.js; implementations live in a **separate process or doer plugin** with narrow **`ApprovedDoerTask`** contracts, timeouts, and allowlists. **Human approval** defaults stricter for OS-level automation than for a single chat send.

### H. Multitenant isolation and private uploads (MiraChat API)

**Product requirement:** Each end-user’s **memory, transcripts, desktop ingest, identity, relationship notes, drafts, metrics, and audit rows** must be **logically isolated**. Another tenant must not read or mutate them by changing `userId` in JSON or query strings.

**Implemented controls (MiraChat HTTP API):**

| Control | Behavior |
| --- | --- |
| **Optional enforcement** | Set `MIRACHAT_TENANT_ENFORCE=1` on the API process. When **off** (default), behavior matches legacy dev: `userId` comes from the client (still not safe on untrusted networks). |
| **Bearer-bound subject** | With enforcement on, clients send `Authorization: Bearer <token>`. The API resolves a **canonical user id** from the token and **rejects** requests where the body/query `userId` does not match that subject (`403`). If the client omits `userId`, the API uses the token subject. |
| **Token map (MVP)** | `MIRACHAT_TENANT_TOKEN_MAP` — JSON object mapping opaque bearer strings to user ids, e.g. `{"dev-ops-token":"demo-user"}`. Suitable for ops console + server-side workers. |
| **Signed tokens** | `MIRACHAT_TENANT_HMAC_SECRET` — bearer value is `base64url(payload).base64url(hmac_sha256(secret, payload))` with payload `{"sub":"<userId>","exp":<unixOptional>}`. Issue tokens from the `MiraChat` package: `MIRACHAT_TENANT_HMAC_SECRET=… node scripts/mirachat-issue-tenant-token.mjs <userId> [ttlSeconds]`. |
| **Thread reads** | When `userId` is supplied to thread history assembly, **inbound**, **sent outbound**, and **memory_chunks** are filtered by that `user_id`, closing cross-tenant leakage for shared `thread_id` strings. |
| **Drafts / pending send** | Under enforcement, draft triage and pending-send lists are scoped to the authenticated user. Draft approve/reject/edit actions verify **draft ownership** before mutating. |
| **Delegation audit** | Under enforcement, `GET /mirachat/delegation-events` returns only rows whose `user_id` equals the tenant (omits global/system rows with null `user_id`). |
| **Ops console** | Connection drawer field **Tenant bearer token** persists to local storage and is sent on every API `fetch` as `Authorization`. |

**Platform and subprocessors:** Uploads and analysis may still be sent to **OpenRouter** (or other LLM providers) per product settings; contracts and data-minimization remain **separate compliance** work. **Row-level security** in Postgres is recommended for defense-in-depth but is not required for the bearer-binding MVP.

**Future:** Replace opaque token map with **OIDC / Clerk / Sign in with Vercel** so `sub` comes from a real IdP; keep the same “deny if claimed `userId` ≠ subject” rule.

---

## 6. Go-to-market and wedge strategy

| Phase | Wedge | Differentiation |
| --- | --- | --- |
| **1** | **High-context coordination** | Not “find a slot”—**negotiate using UserModel**: e.g. defer vendor, prioritize board; relationship-weighted scheduling. |
| **2** | **Unified inbox proxy** | Email and Slack (native integrations/adapters): routine approvals, status updates, polite declines—same identity and policy layer. |
| **3** | **Agent-to-agent protocol** | Proxies negotiate with other Proxies—**async coordination layer**; long-term structural moat. |

### 6.1 Embedded product marketing (in-flow narrative)

**Problem:** A separate marketing site cannot carry the **trust and category** story at the moment of use. Users form their mental model from the **first inbox screen**, draft review, and settings — not from a landing page they may never see.

**Objective:** Embed a **concise, repeatable narrative** in the primary product surfaces (MiraChat ops console, web / Mini Program–style clients, and secondary dashboards) so every session reinforces the PRD mission:

- **Category:** *Proxy Self* = **bounded delegate** (acts on your behalf **inside guardrails**), **not** “faster autocomplete” or generic AI writing.
- **Core principle:** *Protect user intent; delegate the execution* — echoed in empty states and help copy where it fits without noise.
- **Trust loop (G1):** **Approve before send** and **private until you act** are both **product claims** and **UX requirements** (see trust notes alongside queues and draft panels).
- **Wedge:** **Relationship-aware** tone and prioritization vs tools that only optimize calendar whitespace or raw speed.

**Strategic pillars (copy architecture)**

| Pillar | User-facing job | PRD anchor |
| --- | --- | --- |
| **Reframe the category** | “Delegate,” not “generate text” | §1 vision, §11 differentiation |
| **Make trust visible** | Private to you, nothing sent until approval | §5.D delegation layer, GQM G1 |
| **State the wedge** | Tone and relationship context, not generic speed | §6 phase 1 wedge, §5.A identity |
| **Repeat the principle** | One-line mission in onboarding-style empty states | *Protect intent; delegate execution* |

**Touchpoints (minimum lovable set)**

| Moment in flow | Surface | Message job |
| --- | --- | --- |
| **App entry / inbox** | Sidebar **mission strip** (persistent) | Brand line + three scannable beats: bounded delegate, protect intent / approve before send, relationship-aware tone |
| **No thread selected** | Empty state body + italic **mission line** | Emotional benefit + verbatim principle |
| **Draft review** | “Pick a reply” + trust footnote | Reinforce control before delivery |
| **Identity / relationship / import** | Drawer sections | Moat (voice, boundaries) + confidentiality vs contact |
| **Audit / metrics** | Operator dashboards | “Your team / your account” framing — not shown to message contacts |

**Implementation rules**

- **Brevity:** One short strip + one optional principle line; avoid paragraph marketing on every screen.
- **Honesty:** Do not imply full autonomy in v1; marketing copy must match **§4** scope (draft → copy → manual send default).
- **Consistency:** Same mission strip lexicon across **ops-console** and **web-client** (and future Mini Program) so multi-surface users get one story.
- **Test contract:** The primary mission strip carries `data-testid="prd-mission-strip"`; the **real-stack Playwright** suite ([`prd-gqm-e2e-test-suite.md`](prd-gqm-e2e-test-suite.md)) asserts it is visible and contains **Proxy Self**, **bounded delegate**, and **Protect intent** so positioning cannot regress silently.

**Future (optional):** Instrument strip impressions or time-in-view in product analytics; correlate with approval-without-edit rate (GQM) — not required for MVP.

**Integration sequencing (risk)** (unchanged product strategy): Prefer **standard OAuth** (e.g. Gmail) where possible; keep plugins isolated so compliant and unofficial paths can coexist behind the same core contracts.

---

## 7. Key success metrics (PMF and trust signals)

Full **Goal–Question–Metric** breakdown, targets, experiments, and cross-system metrics: [product-GQM-MiraForU.md](product-GQM-MiraForU.md).

| Metric | Definition | Direction |
| --- | --- | --- |
| **Time-to-value** | Historical ingestion → first **accurate** draft | Target: **&lt; 5 minutes** |
| **Trust (proxy)** | **% of drafts approved without edits** | Target: **&gt; 70%** |
| **Delegation velocity** | Time for user to move a recurring contact to highly trusted **Approve** | Decrease over cohorts |
| **Efficiency** | **≥ 30%** reduction in average thread resolution time | Increase |
| **Regret (aspirational)** | User-reported “should not have sent” / serious harm | Drive toward **&lt; 1%**; instrument with surveys and support tags |

**Instrumentation:** Log at dispatcher, policy branches, and approval outcomes (e.g. `logEvent({ type: 'AUTO_SEND', confidence, userId, policyRuleId, … })`).

---

## 8. Key user flows (system execution)

The system shifts from a "chat interface" to an "autonomous proxy" model. The user interacts with MiraChat by simply forwarding context (text, photos, voice notes), and the system handles the cognitive load of figuring out the next step.

1. **Ingest & Contextualize:** The user sends a message or photo to MiraChat (e.g., via SMS or the iOS app) and tags the intended recipient.
2. **Ledger Attention (The "Aha!" Moment):** The system does not just look at the photo. It scans the user's entire **Commitment Ledger** and uses an Attention LLM to extract only the facts relevant to this specific photo and recipient.
3. **Draft & Policy Evaluation:** 
   - The **Drafter** writes a message using the extracted facts and the recipient's preferred tone.
   - The **Policy Engine** independently reviews the draft against the user's Hard Constraints (e.g., "No financial commitments", "No sensitive medical data").
4. **Ops Console Triage:** The result lands in the user's Ops Console with a clear status: `AUTO_SEND` (counting down), `DRAFTED` (needs review), or `BLOCKED` (policy violation).

### Ops Console UI Design

To build trust, the Ops Console must expose the AI's reasoning. The UI for each message card will be updated to include:

*   **Status Header & Badges:**
    *   🟢 `[AUTO_SEND in 2:59]` - For low-risk, highly confident drafts.
    *   🟡 `[DRAFTED: Review Required]` - For medium-risk or complex drafts.
    *   🔴 `[BLOCKED: Policy Violation]` - For drafts that broke a hard constraint.
*   **The "Grounded In" Panel (Attended Ledger):**
    *   A collapsible side-panel next to the draft showing *exactly* which facts the AI used. 
    *   *Example UI text:* "🧠 **AI Context:** • Recipient: Mike (Mechanic) • Past Event: Mike serviced the VW Golf last month."
*   **Policy Engine Feedback:**
    *   If blocked, a bright red banner explains why: *"⚠️ Blocked by Policy Engine: Draft contained unauthorized financial commitment (>$500)."*

### Concrete Examples in the UI

**Scenario A: The Car Oil Leak (High Utility, Low Risk)**
*   **User Action:** User takes a photo of an oil leak under their car, selects "Mike (Mechanic)", and hits send.
*   **Ops Console UI:**
    *   **Badge:** 🟢 `[AUTO_SEND in 3:00]`
    *   **Draft:** *"Hi Mike, my VW Golf is leaking oil from the gearbox again (see photo). Since you just serviced it last month, can I bring it in tomorrow morning for you to take a look?"*
    *   **Grounded In Panel:** 
        *   ✅ *Entity: 2018 VW Golf*
        *   ✅ *Event: Serviced by Mike last month*
        *   ✅ *Tone: Direct/Polite*

**Scenario B: The Plan B Package (High Risk, Sensitive)**
*   **User Action:** User takes a photo of a Plan B package and selects their partner.
*   **Ops Console UI:**
    *   **Badge:** 🔴 `[BLOCKED: Sensitive Medical Context]`
    *   **Draft:** *(Draft is hidden or grayed out)*
    *   **Policy Engine Banner:** *"⚠️ Blocked: The Policy Engine detected highly sensitive medical context. Drafting is disabled for this topic to protect your privacy. Please reply manually."*

**Scenario C: The Indoor Tennis Practice (Continuity)**
*   **User Action:** User sends a photo of themselves hitting a tennis ball to "Coach Dave".
*   **Ops Console UI:**
    *   **Badge:** 🟢 `[AUTO_SEND in 3:00]`
    *   **Draft:** *"Hey Dave, working on that forehand follow-through we talked about last week. Does this extension look better to you?"*
    *   **Grounded In Panel:**
        *   ✅ *Event: Working on forehand follow-through since last Tuesday.*

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Hallucinations / social or professional harm** | Strict bounding in early versions; **deterministic rule overlays** on LLM output; default approve; block high-stakes classes. |
| **Cross-platform integration friction** | OAuth-first where stable; **channel plugin** isolation; unofficial clients in dedicated gateway processes; session restart/backoff. |
| **Over-automation** | Default **APPROVE**; AUTO is explicit per rule/contact. |
| **Latency** | Fast paths where safe; async approval queue for outbound. |
| **Platform instability** | Confined to **channel plugins**; never entangle with core policy/memory. |
| **Desktop RPA / nut.js fragility** | **Doer-only** deployment; explicit user consent; stricter **APPROVE** defaults; audit steps; disclose breakage from UI updates, focus, and multi-monitor/DPI. |

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
| Memory | Cross-channel, durable; **entity-first** specificity, **sequential** temporal reasoning, **user narrative** layer—plus trajectory, not one-thread only |
| Delegation | Policy engine + audit |
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

1. **Data:** `UserModel` + relationship graph **schema** and **pipeline** for historical context ingestion (OAuth, embedding jobs, PII boundaries)—aligned with **[§5.B.1](#b1-memory-system-strategy-priorities)** (entity extraction, sequential events, narrative distillation).
2. **Narrative:** **GTM and fundraising** storyboard (wedge slides, moat, cold-start demo path) — keep **in-product copy** ([§6.1](#61-embedded-product-marketing-in-flow-narrative)) aligned when the mission or wedge wording changes; update Playwright expectations if the `prd-mission-strip` lexicon changes.
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
| 0.6 | 2026-04-02 | §5 **G**: **Desktop computer use** capability—**nut.js** + browser tiers (Playwright/Puppeteer), MVP vs production stack, doer boundary; §9 risk row for desktop RPA |
| 0.7 | 2026-04-02 | §5 **G** table: npm **`@nut-tree-fork/nut-js`**, arm64 **libnut** postinstall note |
| 0.8 | 2026-04-03 | §6.1 **Embedded product marketing**: in-flow narrative strategy, touchpoint map, `data-testid` / e2e contract; mission strip + principle line in MiraChat UIs |
| 0.9 | 2026-04-03 | §5.B.1 **Memory system strategy**: prioritized layers—(1) entity specificity per multimodal input, (2) sequential/temporal patterns, (3) user narrative as self-representation; §11 Memory row; §14 next steps cross-link |
