# Measurement system — GQM alignment (MiraForU / MiraChat)

**Companion:** [product-GQM-MiraForU.md](product-GQM-MiraForU.md) · [PRD-MiraForU.md](PRD-MiraForU.md)

## Purpose

Provide a **single append-only audit trail** for product and trust metrics: dispatcher/policy outcomes, draft lifecycle, and sends. Events are stored in PostgreSQL (`delegation_events`) so you can compute GQM proxies with SQL without standing up a separate analytics vendor first.

## Design principles

1. **Emit at system boundaries** — ingest, policy evaluation, draft creation, human triage, actuation (mark sent).
2. **Stable event names** — dot-separated types (e.g. `policy.evaluated`); avoid renaming without a migration note.
3. **Structured columns + JSON metadata** — filterable fields (`user_id`, `policy_action`, `confidence`, `draft_id`) plus `metadata` for reasons, intent, errors, and future PII-scrubbed blobs.
4. **No blocking on measurement** — insert failures should not break primary flows (implementation uses fire-and-forget `void` + catch in API where needed).

## Schema (`delegation_events`)

Defined in `MiraChat/packages/db/migrations/002_prd_delegation.sql`, extended in `003_delegation_events_thread.sql`:

| Column | Role |
| --- | --- |
| `event_type` | Canonical event name |
| `user_id`, `channel`, `account_id` | Tenant / slice |
| `thread_id` | Thread-scoped funnels (optional) |
| `policy_action` | Last evaluated action for `policy.evaluated` (`BLOCK`, `REVIEW`, `AUTO_SEND`) |
| `confidence` | Model/policy confidence when relevant |
| `policy_rule_id` | Engine or rule set id (e.g. `default_v1`) |
| `draft_id`, `inbound_message_id` | Join to `outbound_drafts` / `inbound_messages` |
| `metadata` | JSON: `reasons`, `intent_domain`, `error`, edit stats, etc. |

## Event catalog

| `event_type` | When emitted | Typical `policy_action` / `metadata` |
| --- | --- | --- |
| `inbound.enqueued` | After `insertInboundMessage` + queue | `metadata.contact_id`, `message_id` |
| `assist.generated` | After `/mirachat/assist` | `metadata.intent_domain`, option counts |
| `summary.generated` | After `/mirachat/summarize-thread` | `metadata.message_count` |
| `policy.evaluated` | After `PolicyEngine.evaluate` in worker | `policy_action`, `metadata.policy_reasons`, `metadata.intent_domain` |
| `draft.created` | After `insertOutboundDraft` | `confidence`, `draft_id`, `metadata.intent_summary` |
| `draft.auto_queued` | Policy-approved draft enters send queue without human review | `draft_id`, policy reasons |
| `draft.auto_sent` | Auto-queued draft is actually sent | `draft_id` |
| `draft.approved_as_is` | Approve endpoint, no edit | `draft_id` |
| `draft.approved_with_edit` | Edit+approve | `metadata.generated_len`, `edited_len` |
| `draft.rejected` | Reject endpoint | `draft_id` |
| `outbound.sent` | After `markOutboundSent` | `draft_id`, `metadata.channel` |
| `mode.changed` | User changes thread delegation mode | `metadata.from_mode`, `to_mode`, `direction` |
| `trust.regression` | User lowers autonomy level | `metadata.from_mode`, `to_mode`, reason |
| `feedback.sounds_like_me` | Manual research input | `metadata.score` (1–5), optional note |
| `feedback.regret` | Manual research input | Optional note / severity |
| `feedback.boundary_violation` | Manual research input | Optional note |
| `pipeline.failed` | Worker catch block | `metadata.error`, `inbound_message_id` |

## GQM mapping (how to derive metrics)

| GQM / PRD metric | Source |
| --- | --- |
| **Drafts approved without edits** (>70% target) | `draft.approved_as_is / (draft.approved_as_is + draft.approved_with_edit)` in window |
| **Policy mix / guardrail volume** | Count `policy.evaluated` grouped by `policy_action` |
| **Assisted/delegated volume (proxy)** | `draft.created`, `outbound.sent` counts vs manual (manual = not in system—define per channel) |
| **Embarrassment / recall (future)** | New events: `outbound.recalled` or client `user.regret_tag` — not in v1 |
| **Time-to-value (future)** | `first draft.created` after `user.onboarding_completed` — needs onboarding event |
| **Delegation velocity (future)** | `relationship.auto_reply_enabled` transitions + `policy.evaluated` with `AUTO_SEND` |

## API

- **`GET /mirachat/metrics?days=7&userId=`** — Pre-aggregated counts and **approval-without-edit rate** for the window.
- **`POST /mirachat/delegation-mode`** — Persist Assist/Approve/Auto mode transitions and trust-regression events.
- **`POST /mirachat/feedback`** — Write subjective GQM signals (`sounds_like_me`, `regret`, `boundary_violation`) into `delegation_events`.
- **UI:** `MiraChat/apps/ops-console/dist/measurement/index.html` (and `measurement.html`) is the dedicated `/measurement` dashboard page.

## Privacy

- Prefer **ids** (`user_id`, `thread_id`, `draft_id`) in columns; keep message **text** out of `delegation_events`.
- `metadata` should not duplicate full prompts; scrub before exporting to third-party analytics.

## Code map

| Area | File |
| --- | --- |
| Event name constants | `MiraChat/packages/db/src/delegation-event-types.ts` |
| Insert + rollup query | `MiraChat/packages/db/src/repos.ts` |
| Worker instrumentation | `MiraChat/services/api/src/mirachat-worker.ts` |
| Ingest + triage + send | `MiraChat/services/api/src/index.ts` |
