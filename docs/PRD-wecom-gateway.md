# Product Requirements Document — MiraChat WeCom Gateway

| Field | Value |
| --- | --- |
| Product area | MiraChat official channel adapter |
| Component | Proposed `MiraChat/apps/gateway-wecom` |
| Document type | Adapter PRD |
| Status | Draft |
| Related docs | [PRD-MiraForU.md](./PRD-MiraForU.md), [PRD-wechaty-gateway.md](./PRD-wechaty-gateway.md), [system-design-proxy-self.md](./system-design-proxy-self.md) |

This PRD covers **WeCom** as the official enterprise-grade WeChat ecosystem channel for MiraChat. Unlike personal-account automation, WeCom should be treated as a supported business messaging surface with explicit admin setup, org identity, and policy-safe delivery.

---

## 1. Purpose

Provide a compliant, stable WeChat-adjacent gateway that:

- connects a company-owned WeCom tenant to MiraChat
- receives inbound enterprise messages through official callbacks
- sends approved outbound drafts through official APIs
- maps org, employee, and external-contact identity into the shared MiraChat model

**Principle:** use WeCom for legitimate business communication paths, not as a workaround for personal-account automation risk.

---

## 2. Problem

MiraChat needs an official channel in the WeChat ecosystem that can support real-world business usage without relying on personal WeChat session automation.

Without a WeCom adapter:

- the product remains dependent on higher-risk unofficial runtimes for China-market messaging
- enterprise identity and admin controls are missing from the channel layer
- customer-facing business messaging cannot be positioned as compliant or durable
- the system cannot distinguish org-owned accounts from personal accounts at the transport boundary

---

## 3. Users and Jobs To Be Done

### Primary users

- enterprise operators using MiraChat to assist with customer, partner, or internal messaging
- admins configuring official org messaging surfaces

### Jobs to be done

- Connect our company WeCom account to MiraChat with admin-approved credentials.
- Ingest official inbound messages into MiraChat's approval and policy flow.
- Route approved outbound responses through a legitimate business channel.
- Preserve which employee, org account, or external contact a thread belongs to.

---

## 4. Product Goals

1. **Adopt an official enterprise channel.**
   Replace personal-account fragility with a legitimate admin-managed integration path.
2. **Keep the core transport-neutral.**
   Normalize WeCom-specific payloads into the same event model used by other channels.
3. **Support approval-first outbound behavior.**
   Even on an official channel, MiraChat should send only approved or policy-cleared messages.
4. **Map enterprise identity explicitly.**
   Capture org, app, employee, and external-contact identifiers cleanly at the adapter edge.

---

## 5. Non-Goals

- Reproducing personal WeChat behavior inside WeCom
- Building WeCom-only business logic into the core agent runtime
- Broad admin-console provisioning in v1
- Full CRM replacement or deep enterprise workflow orchestration in the first version

---

## 6. MVP Scope

### In scope

- configure tenant, app, and secret material for a WeCom integration
- receive official inbound callbacks from WeCom
- verify request authenticity at the gateway boundary
- normalize inbound messages into MiraChat event shape
- send approved text replies through the official send API
- represent connection and delivery health in MiraChat

### Out of scope for MVP

- full media matrix support
- advanced org-directory sync and SCIM-like lifecycle management
- multi-tenant admin self-serve onboarding
- deep workflow automation beyond reply drafting and send

---

## 7. User Experience Requirements

### 7.1 Admin onboarding

- Setup must be credential-based and admin-approved, not QR session-based.
- MiraChat must expose whether the WeCom integration is configured, healthy, and authorized.
- Credential or callback validation failures must be visible to operators.

### 7.2 Inbound message handling

- The gateway must accept official inbound callbacks and verify them before processing.
- Messages must resolve to the right `channel`, `accountId`, `threadId`, `senderId`, and org context.
- External-contact and employee-originated messages must remain distinguishable in metadata.

### 7.3 Outbound message handling

- Approved drafts must send through the official API path.
- Failed sends must be observable and retriable without losing approval state.
- The gateway must preserve clear auditability of who approved and what was sent.

---

## 8. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | The gateway must verify inbound callback authenticity before accepting events. |
| FR-2 | The gateway must normalize WeCom payloads into MiraChat's transport-neutral event contract. |
| FR-3 | The gateway must associate messages with org-owned `accountId` values rather than ad hoc session ids. |
| FR-4 | The gateway must send approved outbound text through official WeCom APIs. |
| FR-5 | The gateway must expose integration health, auth failure, and callback failure status to MiraChat. |
| FR-6 | The gateway must isolate all WeCom SDK/API details from core packages. |
| FR-7 | The gateway must support employee and external-contact identity mapping in metadata. |
| FR-8 | The gateway must degrade safely when credentials expire or callbacks fail. |

---

## 9. Success Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Callback verification success | Share of inbound callbacks validated successfully | > 99% |
| Inbound normalization success | Share of valid WeCom events accepted by MiraChat API | > 95% |
| Approved-send success | Share of approved outbound drafts sent successfully | > 97% |
| Integration uptime | Time integration remains healthy without manual re-auth | Higher than Wechaty baseline |
| Enterprise channel adoption | Share of China-market business usage moved to official path | Increasing over time |

---

## 10. Key Flows

### 10.1 Admin setup

```text
Admin configures WeCom app -> credentials/callbacks registered ->
MiraChat validates integration -> channel marked healthy
```

### 10.2 Inbound message to draft

```text
WeCom official callback -> gateway verifies request ->
normalize payload -> POST /mirachat/inbound ->
core policy/agent flow -> draft appears in approval system
```

### 10.3 Approved draft to official send

```text
Approval granted in MiraChat -> gateway retrieves pending approved draft ->
send via WeCom API -> record send outcome -> mark draft sent
```

---

## 11. Architecture Constraints

- `gateway-wecom` is an adapter only.
- Core packages must not depend on WeCom-specific request or response objects.
- Tenant credentials and app configuration must be stored and rotated as secrets.
- Enterprise org identity must not be collapsed into a single generic user identifier.
- The product moat remains policy, identity, memory, and approval, not the channel SDK itself.

---

## 12. Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Enterprise setup complexity | Official channels trade convenience for admin friction | Build an explicit admin onboarding checklist and health diagnostics |
| Identity ambiguity | Employee, org app, and external contact can be conflated | Normalize and store org-aware metadata at the edge |
| Callback/auth failures | Silent failures can drop inbound traffic | Signature verification, health checks, event logging, retries |
| Policy leakage into adapter | Channel-specific shortcuts weaken architecture | Keep approval and policy in core only |
| Over-scoping | Enterprise asks can balloon into CRM or workflow product | Keep v1 focused on messaging ingest and approved send |

---

## 13. Rollout Plan

### Phase 1

- single org
- one approved WeCom app
- text-only
- approval-first outbound

### Phase 2

- stronger delivery observability
- richer org/contact identity sync
- operator tooling for callback and credential health

### Phase 3

- additional message types
- limited policy-gated automation for low-risk categories
- broader multi-org onboarding

---

## 14. Open Questions

- Which WeCom app model best matches MiraChat's intended user experience?
- How should external customer threads map into `threadId` and relationship memory?
- What are the minimum admin steps needed for a first usable pilot?
- Which delivery receipts or webhook events should become first-class metrics?

---

## 15. Decision Summary

Use **WeCom** as the official business-grade channel in the WeChat ecosystem when the product needs legitimacy, durability, and admin-managed integration. It should be the preferred replacement for high-risk personal-account automation in enterprise or customer-facing use cases.
