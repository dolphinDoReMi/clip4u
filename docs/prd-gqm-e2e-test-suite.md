# PRD & GQM — executable validation suite

This document maps **MiraForU / Proxy Self** requirements ([PRD-MiraForU.md](./PRD-MiraForU.md), [product-GQM-MiraForU.md](./product-GQM-MiraForU.md)) to automated checks in the MiraChat monorepo.

## Test Design Principle

PRD/GQM acceptance validation is **real only**:

- **no mocks**
- **no Docker requirement in the test design**
- **real PostgreSQL with `pgvector`**
- **real API + real pg-boss worker + real browser UI**

Fast mocked tests may still exist in the repo for developer feedback, but they are **supporting tests**, not the PRD acceptance gate.

## How to run

### Fast developer tests (supporting, not PRD acceptance)

From `MiraChat/`:

```bash
npm install
npm run test:fast
```

### Real PRD/GQM acceptance (no mocks, no Docker dependency)

Requires a reachable PostgreSQL instance with `pgvector` enabled and `E2E_DATABASE_URL` or `DATABASE_URL` set.

```bash
cd MiraChat
npm install
npx playwright install chromium   # once per machine
npm run test:prd
```

- Runs the real DB pipeline spec (`tests/e2e/mirachat-pipeline.e2e.spec.ts`)
- Starts **@delegate-ai/api** with `DATABASE_URL` (migrations + pg-boss + worker)
- Serves **ops-console** on port **4473** and API on **4400**
- Runs the real Playwright UI suite
- Fails immediately when the real DB env is missing

Reuse already-running servers: `PW_REUSE_SERVERS=1 npm run test:e2e`.

### CI

GitHub Actions workflow: `.github/workflows/mirachat-prd-gqm.yml`

- **Supporting job** (`mirachat-fast-tests`): always runs `npm run test:fast` (no secrets, including fork PRs)
- **Real acceptance job** (`validate-prd-gqm`): requires repository secret `MIRACHAT_CI_DATABASE_URL`, runs `npm run test:prd`, uploads Playwright artifacts on failure
- On fork PRs or repos without that secret, the real job writes a summary and skips the acceptance run; the supporting job still provides automated feedback

### Real DB pipeline only (no UI)

With `E2E_DATABASE_URL` or `DATABASE_URL` set:

```bash
npm run test:prd:db
```

Implementation under PRD acceptance: `services/api` (`api-listener.ts`, `mirachat-worker.ts`), `packages/db`, `packages/identity`, `packages/memory`, `packages/policy-engine`, `packages/agent-core`, `apps/ops-console`.

## Test inventory (by file)

| File | Focus |
| --- | --- |
| `tests/e2e/mirachat-pipeline.e2e.spec.ts` | **Real DB pipeline**: inbound row → worker → outbound_drafts row |
| `tests/e2e-ui/ops-console.prd-gqm.pw.ts` | **Real UI + real Postgres + real API + real worker**: draft/approve/send, assist/options modal, summarize-thread dialog, relationship-driven policy outcome, metrics/audit drawer |

Other specs in `tests/` (including mocked/unit tests) are supporting coverage and are **not** the PRD acceptance gate.

### Supporting tests (not PRD acceptance)

Fast tests such as `tests/prd-gqm.spec.ts`, `tests/gqm-rollup.spec.ts`, `tests/mirachat-worker.prd-gqm.spec.ts`, and `tests/api-http.spec.ts` remain useful for rapid feedback, but they are not counted as the real PRD sign-off path because some use mocks or isolated in-memory services.

## Traceability matrix (PRD / GQM → test)

### G1 — Trustworthy delegation

| Source | Requirement | Test |
| --- | --- | --- |
| PRD §5.D | Financial / hard-boundary → BLOCK | Real DB pipeline + Playwright user flows observe blocked / review-safe behavior in the live system |
| GQM Q1.3 | `low_confidence` → REVIEW | Playwright approval panel remains in review flow; no silent auto-send in v1 |
| PRD MVP | Default human approval | Playwright — *draft → approve → mark sent is visible in the UI* |
| PRD | High-risk relationship → REVIEW | Playwright — *saving relationship settings changes the next draft policy outcome* |

### G2 — Productivity

| Source | Requirement | Test |
| --- | --- | --- |
| PRD §4 | Multi-option assist | Playwright — *assist modal shows real thread summary and multi-option replies* |
| GQM | Delegation event stream for analytics | Playwright — *metrics and audit drawer* after real user actions |

### G3 — Identity & intent

| Source | Requirement | Test |
| --- | --- | --- |
| PRD §4 | Relationship settings affect live behavior | Playwright — *saving relationship settings changes the next draft policy outcome* |
| PRD §4 | Thread summarization | Playwright — *summarize thread returns a real summary dialog* |

### G4 — Safe autonomy

| Source | Requirement | Test |
| --- | --- | --- |
| PRD v2 gate | `AUTO_SEND` only by explicit policy | Covered by supporting tests only today; not part of the v1 real acceptance gate |

### Measurement (GQM §4 PMF dashboard)

| Metric | Implementation | Test |
| --- | --- | --- |
| **Drafts approved without edits** (trust proxy) | `queryGqmRollup.approvalWithoutEditRate` | Playwright metrics drawer on real delegation data; supporting rollup unit test also exists |
| Event / policy_action counts | `queryGqmRollup` | Playwright metrics + audit drawer on real delegation data |

### Approval queue (instrumentation for edit vs as-is)

| Requirement | Test |
| --- | --- |
| Approve / reject / edit flows | Playwright — approve/send path; supporting unit tests cover reject/edit transitions |

## GQM instrumentation (runtime)

| Event (canonical) | Where emitted |
| --- | --- |
| `inbound.enqueued` | API `POST /mirachat/inbound` |
| `policy.evaluated` | `mirachat-worker` after policy |
| `draft.created` | `mirachat-worker` after `insertOutboundDraft` |
| `draft.approved_as_is` / `draft.approved_with_edit` / `draft.rejected` / `outbound.sent` | API draft actions (when using Postgres) |

## Environment flags

| Variable | Effect |
| --- | --- |
| `MIRACHAT_ALLOW_AUTO_SEND=true` | Bounded `AUTO_SEND` for low-risk non-Twilio DMs (v2-style); **off** by default for PRD v1. |

## Related docs

- [PRD-proxy-self-1-pager.md](./PRD-proxy-self-1-pager.md)
- [product-GQM-proxy-self.md](./product-GQM-proxy-self.md)
- [system-design-proxy-self.md](./system-design-proxy-self.md)
