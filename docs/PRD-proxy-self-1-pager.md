# Product Requirements Document — MiraForU (Proxy Self) · 1-Pager

| Field | Value |
| --- | --- |
| Codename | MiraForU |
| Product | Proxy Self — AI Communication Delegate |
| Document type | Condensed one-pager (see [PRD-MiraForU.md](./PRD-MiraForU.md) for full system mapping) |
| Status | Draft |

Proxy Self is a **bounded delegate**, not merely a faster writer: it acts on the user’s behalf within explicit guardrails. This summary supports **early investor** and **engineering** alignment—**defensibility**, **cold start**, and **GTM wedge**. Technical transport (e.g. **Wechaty** for WeChat, **whatsapp-web.js** for WhatsApp) stays at the **adapter edge**; the **owned moat** is **identity**, **policy**, and **cross-channel memory**.

**Wedge clarity:** “Scheduling & coordination” alone is a red ocean (Motion, Calendly AI, Clara, Clockwise, …). The differentiated entry is **high-context coordination driven by the Identity Model**—negotiation and prioritization by **relationship weight** (e.g. board member now, vendor next week), not only calendar whitespace.

**Cold start:** `UserModel` is a moat only if it **bootstraps without heavy manual setup**—e.g. **OAuth ingestion** (Gmail / Slack or comparable, with consent) to **pre-compute embeddings and initial tone/rules**, not 50-field forms on Day 1.

---

## 1. Product vision

Build a **persistent, bounded** AI agent that represents the user in **multi-channel** communication loops. Proxy Self **preserves intent**, manages routine interactions, and **reduces cognitive load**, bridging the gap between an AI writing assistant and a fully autonomous agent.

**Core principle:** *Protect user intent; delegate the execution.*

### Product experience direction

The product should **function like WhatsApp** and **look like Instagram DM**.

| Axis | Product requirement |
| --- | --- |
| **Interaction model** | Use a **WhatsApp-like inbox mental model**: conversation list first, active thread second, fast search, recency ordering, unread state, persistent composer, clear inbound/outbound bubbles, and thread-centric approval flow. |
| **Visual system** | Use an **Instagram-style visual language**: dark editorial surfaces, warm pink-orange-purple gradients, story-ring avatar treatment, pill controls, soft glass elevation, and cleaner typography than utility/admin tooling. |
| **Trust UX** | Approval, policy, and automation controls must feel like **extensions of the thread**, not a separate ops console bolted onto chat. |
| **Cross-surface consistency** | Web console, measurement dashboard, and mini-program should share the same color tokens, shape language, spacing rhythm, and status semantics. |

This distinction is intentional:

- **WhatsApp** defines the **behavioral model** for messaging productivity.
- **Instagram** defines the **brand and visual taste** for the product.

### Design principle (architecture)

**Own decision-making; outsource transport.** Adapters normalize channels into one internal event model; the **core** owns dispatcher, agent, policy, and memory.

| Layer | Role | Implementation (illustrative) |
| --- | --- | --- |
| Edge (I/O) | Messaging / integrations | Wechaty (WeChat), Telegram Bot API webhooks (Telegram), whatsapp-web.js (WhatsApp); expand via OAuth-native surfaces (Gmail, Slack, …) |
| Core (owned) | Moat | Dispatcher (mode + routing), Agent Core (reasoning), Policy Engine (control), Identity + Memory |

---

## 2. The problem

High-output professionals suffer from **communication fragmentation** and **decision fatigue**.

- **Gap:** Tools that optimize **speed of writing** (Grammarly-class, Superhuman-class) do not reliably capture **intent**, **cross-thread context**, or **relationship dynamics** across platforms.
- **Pain:** Context-switching, tone calibration, and **low-leverage coordination** (scheduling, follow-ups, standard declines) crowd out deep work.

---

## 3. Target audience

- **Primary:** Founders, executives, and operators (high-leverage, time-poor).
- **Secondary:** High-volume relationship managers (sales, investors, recruiters).

---

## 4. Product scope (evolution)

| Stage | Positioning | Capabilities |
| --- | --- | --- |
| **MVP (v1)** | **The contextual drafter** | Ingest historical data (consent) to **bootstrap voice**. Multi-channel **thread summarization**, **multi-option replies** (e.g. concise vs relationship-preserving). **Draft → Approve → Send** only. |
| **v1.5** | **Bounded delegation** | Structured rule-sets; **auto follow-ups**; **soft-negotiation scheduling** (multi-party constraints + **relationship priority**, not just free slots). |
| **v2** | **The proxy agent** | **Partial auto-reply** inside hard guardrails. **Persistent, cross-platform relationship memory** and merged context. |

---

## 5. Core technical pillars (the moat)

### A. Identity and intent model

Dynamic, personalized profile—not generic assistant voice. **Cold start** via **historical email/Slack (and similar)** under consent; manual tuning is refinement, not a prerequisite.

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

**Cross-channel** aggregation; **relationship trajectory** (not only current thread). *Illustrative backing store:* Postgres + pgvector; messages and relationships tables per user/thread/contact.

### C. Communication engine

**Agent Core:** planner → executor → evaluator. Negotiation as **tools** (e.g. `scheduleNegotiator`, `constraintResolver`).

### D. Delegation and trust layer (non-negotiable)

- **Graduated autonomy:** Assist (suggest) → Approve (draft) → Auto (execute only inside boundaries).
- **Hard constraints:** e.g. **no financial commitments**, no irreversible decisions without explicit human approval.
- **Transparency and reversibility:** Audit logs (“action taken because of rule X”); rollback/undo where the channel supports it.

**Policy sketch:** `financial_commitment` → **BLOCK**; `low_confidence` → **REVIEW**. Default: **APPROVE**; **AUTO** only via explicit policy.

### E. Channel integration (pattern)

```text
Wechaty / Telegram / WhatsApp / (Gmail, Slack, …)
      ↓
Gateway Adapter → MessageEvent
      ↓
Dispatcher → Agent → Policy → Send
```

**Integration sequencing:** Prefer **standard OAuth** where stable before the most **fragmented or unofficial** adapters; keep adapter isolation so both can coexist.

### F. OpenClaw as doer

For execution beyond drafting, MiraForU can hand approved tasks to **OpenClaw** as a replaceable **doer runtime**.

- MiraForU keeps ownership of identity, relationship memory, policy, approval, and audit.
- OpenClaw performs the approved action through its own agent/session runtime.
- The boundary stays narrow: MiraForU sends a bounded task plus target selector and delivery controls; OpenClaw does not own trust policy.

### G. Desktop computer use (nut.js) + browser automation

**Doer-side only:** **Playwright** / **Puppeteer** for **web** UIs; **[nut.js](https://nutjs.dev/)** (**`@nut-tree-fork/nut-js`** on npm) for **native desktop** mouse/keyboard and screen matching (RPA class). Full “computer use” = compose layers + optional vision/OCR—not one repo. **MVP:** web + nut.js for desktop clients where APIs are missing; **production:** Playwright + nut.js + queue/retries. Core still owns policy, approval, and audit; no nut.js inside channel plugins.

---

## 6. Go-to-market and wedge strategy

| Phase | Wedge | Differentiation |
| --- | --- | --- |
| **1** | **High-context coordination** | Not “find a slot”—**negotiate using UserModel**; relationship-weighted scheduling. |
| **2** | **Unified inbox proxy** | Email and Slack: routine approvals, status updates, polite declines—same identity and policy layer. |
| **3** | **Agent-to-agent protocol** | Proxies negotiate with other Proxies—**async coordination layer**; long-term structural moat. |

---

## 7. Key success metrics (PMF and trust signals)

| Metric | Definition | Direction |
| --- | --- | --- |
| **Time-to-value** | Ingestion → first **accurate** draft | Target: **&lt; 5 minutes** |
| **Trust (proxy)** | **% of drafts approved without edits** | Target: **&gt; 70%** |
| **Delegation velocity** | Time to move a recurring contact **Approve → Auto** | Decrease over cohorts |
| **Efficiency** | **≥ 30%** reduction in average thread resolution time | Increase |
| **Regret (aspirational)** | User-reported “should not have sent” / serious harm | Toward **&lt; 1%**; surveys + support tags |

*North stars like “&lt;1% regret” are hard to observe directly—use **approval without edits**, **time-to-auto-mode**, and **time-to-first-good-draft** as operational proxies.*

---

## 8. Key user flows (system execution)

- **Assisted reply:** message in → `ASSIST` → suggestions / drafts → user sends.
- **Delegated scheduling (v1.5+):** message in → delegate mode → scheduling tool → policy → approve → send.
- **Auto (v2, policy-gated):** message in → policy allows `AUTO` → generate → send immediately.

### UI behavior requirements

- **Desktop:** two-pane chat layout by default, with conversation list on the left and active thread on the right.
- **Mobile:** single-pane flow that prioritizes the conversation list first and enters the thread view on selection.
- **Composer:** fixed at the bottom of the thread, always available, with approval actions visually adjacent to the active draft state.
- **Approval model:** draft review appears inline with the current conversation context, not in a detached admin page.
- **Navigation:** settings, metrics, audit, and identity tools live in secondary surfaces such as drawers or dedicated dashboards, not the primary chat rail.

---

## 9. Risks and mitigations (summary)

| Risk | Mitigation |
| --- | --- |
| Hallucinations / harm | Strict bounding; **deterministic rule overlays** on LLM output; default approve; block high-stakes classes. |
| Cross-platform friction | OAuth-first; **adapter abstraction**; isolate unofficial channel layers. |
| Over-automation | Default **APPROVE**; AUTO explicit per rule/contact. |
| Latency | Fast paths where safe; async approval queue for outbound. |
| Unofficial APIs (WeChat/WhatsApp) | Isolated adapters; never entangle core policy/memory. |

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

**Today:** `Adapters → Dispatcher → Agent → Policy → Send`

**Future:** Proxy ↔ Proxy over a **protocol layer** and **negotiation engine**—an async coordination economy.

**Synthesis:** The product is the **control layer**—identity, policy, delegation, memory—not any single transport. **Max leverage at the edges**; **own** the brain and the trust loop.

---

## 13. Design docs

- UI and design-system audit: [design-audit-proxy-self-ig-ui.md](./design-audit-proxy-self-ig-ui.md)
- System implementation detail: [system-design-proxy-self.md](./system-design-proxy-self.md)

---

## Next steps

See [PRD-MiraForU.md](./PRD-MiraForU.md) §14: data schema + ingestion pipeline; GTM/fundraising narrative; or runnable Node/TS reference (dispatcher, policy stubs, OAuth + one chat adapter).
