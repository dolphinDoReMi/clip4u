# Product GQM Analysis — MiraForU (Proxy Self)

| Field | Value |
| --- | --- |
| Codename | **MiraForU** |
| Product | Proxy Self — AI communication delegate (bounded delegate, not “faster writer” only) |
| Document type | Goal–Question–Metric (GQM) — PMF, trust, execution |
| Canonical file | `docs/product-GQM-MiraForU.md` |

**Core principle (from PRD):** *Protect user intent; delegate the execution.*

**Purpose:** Validate PMF, de-risk trust, and guide execution. Aligns with [PRD — MiraForU](PRD-MiraForU.md); see also [PRD (legacy 1-pager)](PRD-proxy-self-1-pager.md) and [System design](system-design-proxy-self.md). ([`product-GQM-proxy-self.md`](product-GQM-proxy-self.md) redirects here.)

**Architecture anchor (owned moat):** Edge adapters normalize channels → **Dispatcher** (mode + routing) → **Agent Core** → **Policy Engine** → send. **Identity + Memory** and policy are core; transport (e.g. Wechaty, whatsapp-web.js, OAuth surfaces) stays at the adapter edge.

---

## 1. Top-level goals (strategic)

| ID | Goal | Intent |
| --- | --- | --- |
| **G1** | Achieve trustworthy delegation | Users allow the agent to act on their behalf without undue fear of mistakes, social harm, or policy violations (hard constraints honored). |
| **G2** | Deliver measurable productivity gains | Reduce communication overhead, context switching, and thread resolution time in a quantifiable way. |
| **G3** | Preserve user identity and intent (moat) | Outputs reflect tone, boundaries, and goals across channels; **relationship-aware** behavior (not generic assistant voice). |

---

## 2. Goal → question → metric breakdown

### G1 — Trustworthy delegation

**Key questions**

- **Q1.1:** Do users feel safe letting the agent send (or queue) outbound messages?
- **Q1.2:** How often do outputs cause social/professional harm, embarrassment, or **regret** (“should not have sent”)?
- **Q1.3:** Do users understand and control what the agent does (policy, audit, reversibility)?

**Metrics — trust and safety**

| Metric | Definition / notes |
| --- | --- |
| Approve vs manual mix | % of sends via **Approve** path vs fully manual compose/send. |
| **Copied without edits** | **Trust proxy (implicit):** % of drafts copied as-is. Target direction: **> 70%**. |
| Embarrassment / quick-recall rate | (# messages materially edited or undone within ~60s of send) ÷ total sent. |
| **Regret rate (aspirational)** | User-reported “should not have sent” / serious harm (surveys, support tags). PRD direction: **< 1%** (hard to observe—treat as north star, not only operational metric). |
| Critical error / constraint violations | % violating **hard constraints** (e.g. **no financial commitments**, no irreversible decisions without explicit human approval). |

**Metrics — control and transparency**

| Metric | Definition / notes |
| --- | --- |
| Undo usage rate | Healthy correction vs panic threshold (channel-dependent). |
| Policy / guardrail interventions | Blocks, forced **REVIEW**, rule overlays per user per week (e.g. `financial_commitment` → **BLOCK**). |
| Reasoning or audit inspection rate | % of sessions where user inspects explanation or “action taken because of rule X” audit. |

**Targets (reconciled with PRD + GQM)**

- **Copied without edits > 70%** (primary implicit trust proxy).
- **Regret / serious harm < 1%** (aspirational; supplement with embarrassment rate and constraint violations).
- Embarrassment / quick-recall rate **< 1–2%** (operational proxy where regret is sparse).

---

### G2 — Productivity gains

**Key questions**

- **Q2.1:** Does the product reduce time spent resolving threads and coordinating?
- **Q2.2:** Does it reduce cognitive load and context switching?
- **Q2.3:** Does throughput increase (more threads handled at acceptable quality)?

**Metrics — time efficiency**

| Metric | Definition / notes |
| --- | --- |
| **Time-to-value** | Historical ingestion → first **accurate** draft. PRD target: **< 5 minutes** (cold-start / onboarding). |
| **Time-to-first-good-draft** | After ingestion or first session—trust velocity companion metric. |
| Thread resolution time | Average time to “done” per thread; PRD efficiency target: **≥ 30%** reduction vs baseline. |
| Time-to-zero-inbox | Or equivalent backlog-cleared proxy. |
| Assisted / delegated send rate | % of messages via **Assist** suggestions or **Approve** vs fully manual. |

**Metrics — cognitive load (proxies)**

| Metric | Definition / notes |
| --- | --- |
| Edits per draft | Average edits before send on approved path. |
| Session efficiency | Session length vs threads/messages progressed. |
| Context switching | Threads per session or cross-app switches (aligns with **cross-channel** context engine). |

**Metrics — throughput**

| Metric | Definition / notes |
| --- | --- |
| Messages per day | Per user, quality-gated. |
| Parallel thread capacity | Concurrent threads progressed without policy or quality failures. |

**Wedge-aligned coordination (PRD)**

- For scheduling: measure success using **relationship-priority** negotiation (defer vendor, prioritize board)—not **calendar whitespace only** (explicit non-goal in PRD).

**Targets**

- **≥ 30%** reduction in average **thread resolution time** (PRD).
- **≥ 60%** of messages **assisted or delegated** (Assist + Approve).
- **Time-to-value < 5 minutes** where ingestion is in scope.

---

### G3 — Identity and intent preservation (core moat)

**Key questions**

- **Q3.1:** Do outputs match the user’s tone and style?
- **Q3.2:** Do **UserModel** rules and risk constraints hold (boundaries, no disallowed commitments)?
- **Q3.3:** Does behavior adapt by **relationship** (role, trajectory, per-relationship tone)?

**UserModel anchor (PRD)**

```ts
UserModel = {
  toneEmbedding,
  decisionRules,
  preferenceGraph,
  relationshipMemory,
  riskConstraints,
}
```

**Metrics — tone fidelity**

| Metric | Definition / notes |
| --- | --- |
| “Sounds like me” | User rating 1–5. |
| Style deviation | Embedding (or learned) distance vs **ingestion-seeded** baseline + ongoing corpus. |
| Tone rewrite rate | User materially rewrites tone before send. |

**Metrics — decision fidelity**

| Metric | Definition / notes |
| --- | --- |
| Rule alignment | % aligned with `decisionRules` / policy (accept / reject / negotiate / defer). |
| Boundary violation rate | Violations of explicit boundaries and **riskConstraints**. |
| Escalation correctness | % of cases correctly forced to **REVIEW** or user (e.g. `low_confidence` → **REVIEW**). |

**Metrics — relationship awareness**

| Metric | Definition / notes |
| --- | --- |
| Context recall accuracy | Who / what / prior commitments when needed (**relationshipMemory**, cross-thread). |
| Sentiment trajectory alignment | Tone fits relationship state over time. |

**Cold start (PRD)**

| Metric | Definition / notes |
| --- | --- |
| Profile completeness | Coverage of tone, rules, preferences after **consented ingestion** (not 50-field forms as gate). |
| Ingestion → stable tone | Interactions until tone metrics stabilize post-bootstrap. |

**Targets**

- “Sounds like me” **≥ 4.2 / 5** (explicit feedback, watch for response fatigue).
- Boundary and **hard-constraint** violations **≈ 0** operationally.

---

## 3. Cross-cutting system metrics

Tied to **Identity + Memory**, **Policy Engine**, **Agent Core**, and coordination tools.

### Identity model quality

| Metric | Definition / notes |
| --- | --- |
| Profile completeness | Tone, `decisionRules`, preferences, `riskConstraints` coverage. |
| Learning speed | Interactions until tone / rule-alignment metrics stabilize. |
| Drift rate | Deviation from baseline over time. |

### Memory / context engine

*Shift from abstract LLM benchmarks to observable user friction and trust signals.*

| Metric | Definition / notes |
| --- | --- |
| **Edits due to forgotten facts** | % of manual draft edits where the user had to fix a memory mistake (measured via `feedback.memory_miss` or edit reasons). |
| **Oops rate from bad memory** | Frequency of `feedback.memory_miss` or quick-recalls specifically caused by the agent forgetting a rule or fact. |
| **Fast learning from uploads** | How well the AI instantly remembers things from newly uploaded screenshots or files before replying. |
| **Recognizing people everywhere** | Successful linkage of the same person across different apps (e.g., WhatsApp + Telegram). |

### Negotiation / coordination layer

| Metric | Definition / notes |
| --- | --- |
| Task success rate | e.g. scheduling completed under policy without user. |
| Iterations per negotiation | Lower is better. |
| Multi-party resolution success | Resolved within policy. |
| Relationship-priority fidelity | Actions match **relationship weight** vs naive slot-filling (wedge metric). |

---

## 4. PMF signal dashboard (minimum viable instrumentation)

If you track nothing else, track this—**merged from PRD §7 and GQM**.

| Metric | Why it matters | Threshold / direction |
| --- | --- | --- |
| **Time-to-value** | Cold start / onboarding | **< 5 min** to first accurate draft after ingestion |
| **Copied without edits** | Implicit trust proxy | **> 70%** |
| **Thread resolution time** | Efficiency | **≥ 30%** reduction vs baseline |
| % messages assisted / delegated | Usage | **> 60%** |
| Embarrassment / quick-recall rate | Operational trust | **< 2%** |
| **Regret / serious harm** | Ultimate harm | **< 1%** (aspirational; surveys + support) |
| “Sounds like me” | Explicit identity moat | **> 4 / 5** |
| Retention (30-day) | PMF | **> 25–35%** (segment-dependent) |

**Instrumentation (PRD):** Log at **dispatcher**, **policy branches**, and **approval outcomes** (e.g. `logEvent({ type: 'AUTO_SEND' \| 'APPROVE_SEND', confidence, userId, policyRuleId, … })`).

---

## 5. Experimental design (learn fast)

### Experiment 1 — Trust boundary

- **A/B:** Transparent attribution (“AI sent this” / audit visible) vs invisible.
- **Measure:** Trust proxies (approval without edits, regret tags), embarrassment rate, retention.

**Hypothesis:** Transparency increases trust early (consistent with PRD transparency / audit).

### Experiment 2 — Delegation scope and wedge

- **Arm A:** Scheduling with **relationship-priority** and **UserModel** constraints (PRD wedge).
- **Arm B:** “Whitespace only” or generic slot-finder without relationship weighting.

**Measure:** Success rate, retention, trust metrics.

**Hypothesis:** Relationship-aware coordination outperforms calendar-only positioning (PRD non-goal: **weak** “whitespace only” story).

### Experiment 3 — Identity depth / cold start

- **Compare:** **Ingestion-seeded** `UserModel` (+ light tuning) vs heavy manual profile only.

**Measure:** Time-to-value, time-to-first-good-draft, rewrite rate, “sounds like me.”

---

## 6. Critical insight (from GQM)

The system succeeds only if **trust is consistently proven via implicit approval**.

\[
\text{Adoption} \propto \frac{\text{Time saved} \times \text{Outcome improvement}}{\text{Trust risk}}
\]

PRD emphasis: **regret and harm are sparse signals, and explicit feedback suffers from fatigue**—use **copied without edits** and **time-to-first-good-draft** as operational trust proxies alongside embarrassment and constraint violations.

---

## 7. Build implications (aligned with PRD scope)

Map optimization to **MVP (v1) → v1.5** in [PRD — MiraForU](PRD-MiraForU.md).

| Phase | Product stage (PRD) | Optimize |
| --- | --- | --- |
| **1** | **v1** contextual drafter: **Assist**, **Draft → Copy → Manual Transport** | Time-to-value, **copied without edits**, embarrassment/regret proxies, thread resolution time |
| **2** | **v1.5** bounded delegation: rules, auto follow-ups, **soft-negotiation scheduling** | Identity fidelity, relationship-priority coordination success, policy intervention rates |

**Deprioritize as primary north stars**

- Raw LLM benchmark scores.
- Feature breadth without usage / trust / policy metrics.
- Positioning scheduling as **calendar whitespace only** without relationship-aware value (PRD).

---

## 8. Next steps (optional follow-ups)

- **Measurement system (implemented):** Event catalog, `delegation_events` emission points, and **`GET /mirachat/metrics`** — [measurement-system-GQM.md](measurement-system-GQM.md).
- **Instrumentation plan:** Event schema, PII boundaries, logging pipeline—tie to dispatcher + policy + approval (see PRD §7).
- **Architecture mapping:** Multi-user tenancy, normalized **`MessageEvent`**, Wechaty / Telegram / WhatsApp / OAuth adapters per [system design](system-design-proxy-self.md) and PRD §5.
