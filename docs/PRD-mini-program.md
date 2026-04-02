# Product Requirements Document — MiraChat Mini Program Surface

| Field | Value |
| --- | --- |
| Product area | MiraChat official WeChat ecosystem surface |
| Component | Proposed `Mini Program` client + supporting API routes |
| Document type | Product surface PRD |
| Status | Draft |
| Related docs | [PRD-MiraForU.md](./PRD-MiraForU.md), [PRD-wecom-gateway.md](./PRD-wecom-gateway.md), [system-design-proxy-self.md](./system-design-proxy-self.md) |

This PRD covers a **Mini Program** as an official in-WeChat product surface for MiraChat. Unlike a transport adapter, the Mini Program is a user-facing client for review, approvals, summaries, relationship context, and user-initiated workflows inside the WeChat ecosystem.

---

## 1. Purpose

Provide an official in-WeChat interface that lets users:

- review thread context and pending drafts
- approve, edit, or reject replies
- trigger assist workflows intentionally
- see connection, task, and policy status without leaving the WeChat environment

**Principle:** use the Mini Program as a controlled user surface, not as a hidden automation channel.

---

## 2. Problem

MiraChat needs a legitimate WeChat-native user experience for users who want workflow access inside WeChat, but do not need or cannot rely on personal-account automation.

Without a Mini Program:

- MiraChat has no official product surface inside the WeChat ecosystem
- approvals and operator actions must happen in separate web apps or external tools
- the system cannot offer a user-initiated workflow that feels native to WeChat
- official ecosystem presence is limited to transport channels only

---

## 3. Users and Jobs To Be Done

### Primary users

- end users who want to review AI-generated drafts and thread summaries inside WeChat
- operators who need lightweight mobile approvals and visibility

### Jobs to be done

- Open MiraChat from within WeChat and quickly understand what needs attention.
- Review a thread summary and suggested reply options.
- Approve, edit, or reject a pending draft from mobile.
- Ask MiraChat for help on a conversation without handing over full autonomy.

---

## 4. Product Goals

1. **Create an official WeChat-native control surface.**
   Let users interact with MiraChat inside WeChat without relying on unofficial session automation.
2. **Preserve approval-first behavior.**
   The Mini Program should strengthen user control, not bypass it.
3. **Bring high-value context into mobile review flows.**
   Expose thread summaries, reply options, confidence, and policy state clearly.
4. **Support intentional user-initiated AI.**
   Make assist and approval workflows easy without turning the Mini Program into an always-on autonomous agent.

---

## 5. Non-Goals

- Replacing the main core runtime or policy engine
- Acting as a hidden proxy for personal-message scraping
- Full-featured CRM, helpdesk, or inbox replacement in v1
- Broad social or commerce feature scope outside the delegation product

---

## 6. MVP Scope

### In scope

- secure sign-in/session binding to a MiraChat user
- list pending drafts requiring action
- display thread summary, inbound text, generated draft, and reply options
- allow approve, edit-and-approve, reject, and select-option actions
- show connection health and recent delegation events
- user-triggered assist actions such as summarize or draft suggestions

### Out of scope for MVP

- full conversation inbox parity with desktop operations
- broad notification center or marketing flows
- offline mode
- advanced collaborative workflows across many approvers

---

## 7. User Experience Requirements

### 7.1 Home / dashboard

- Users must immediately see what needs action: pending approvals, blocked items, and recent sent items.
- Connection state for linked channels should be visible at a glance.
- The UI should favor short review loops over dense enterprise dashboards.

### 7.2 Draft review

- Each pending draft must show inbound text, thread summary, generated reply, and confidence/policy context.
- Users must be able to approve as-is, edit, reject, or choose an alternate reply option.
- The experience must be mobile-first and fast enough for on-the-go approvals.

### 7.3 Assist workflows

- Users should be able to request summary, rewrite, or reply suggestions intentionally.
- The Mini Program should surface that AI output is advisory until the user approves an action.

---

## 8. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | The Mini Program must authenticate the WeChat user into a bound MiraChat user session. |
| FR-2 | The Mini Program must list pending drafts and render the same approval actions supported by the API. |
| FR-3 | The Mini Program must show thread summary, inbound text, generated text, and reply options clearly. |
| FR-4 | The Mini Program must support approve, reject, edit-and-approve, and select-option actions. |
| FR-5 | The Mini Program must expose connection status and recent workflow state from MiraChat APIs. |
| FR-6 | The Mini Program must support user-triggered assist requests without bypassing approval rules. |
| FR-7 | The Mini Program must be optimized for mobile review flows and intermittent attention. |
| FR-8 | The Mini Program must not become the source of truth for policy or memory; it is a client on top of the core runtime. |

---

## 9. Success Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Approval turnaround time | Time from draft creation to user action in Mini Program | Decrease materially |
| Mobile approval rate | Share of approvals completed through Mini Program | Increase over pilot |
| Approval without edit rate | Share of drafts approved as-is from Mini Program | Track as trust proxy |
| Session completion rate | Share of users reaching review/approval state after launch | > 80% in pilot |
| Official-surface adoption | Share of WeChat-ecosystem usage handled through Mini Program flows | Increasing over time |

---

## 10. Key Flows

### 10.1 Open and review

```text
User opens Mini Program -> authenticated to MiraChat identity ->
dashboard loads pending drafts and connection health
```

### 10.2 Approve a pending draft

```text
User opens draft -> reviews summary and reply options ->
approve / edit / reject -> MiraChat updates draft state ->
channel gateway handles send if approved
```

### 10.3 Ask for assist

```text
User enters a message or opens a thread -> requests summary or suggestions ->
MiraChat returns assist output -> user chooses whether to turn it into an approval action
```

---

## 11. Architecture Constraints

- The Mini Program is a client surface, not a transport adapter.
- It should consume stable MiraChat APIs rather than embed core decision logic locally.
- Approval, identity, memory, and policy remain server-owned.
- Mobile UX constraints should simplify flows, not weaken auditability.
- All AI-generated actions surfaced in the Mini Program must still honor core policy and approval rules.

---

## 12. Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Overloading a small mobile surface | Too much context can make approvals slow | Prioritize summaries, concise cards, and fast actions |
| Treating Mini Program as an automation loophole | Weakens product trust model | Keep all sends and policy decisions server-mediated |
| Identity binding confusion | WeChat user identity may not map cleanly to MiraChat user | Explicit account linking and session diagnostics |
| Scope creep | Easy to turn into a general-purpose app | Keep v1 centered on approvals, assist, and visibility |
| Notification dependence | Users may expect rich push behavior | Start with pull-based review loops and explicit user entry points |

---

## 13. Rollout Plan

### Phase 1

- one linked MiraChat user account
- pending-draft review only
- thread summary + reply options + approve/reject/edit

### Phase 2

- connection health and delegation event visibility
- user-triggered assist features
- better mobile navigation for threads and recent activity

### Phase 3

- richer approval workflows
- tighter integration with official channel notifications where allowed
- role-based views for operators and managers

---

## 14. Open Questions

- What is the best account-linking model between WeChat identity and MiraChat user identity?
- Should the Mini Program expose full thread history or only recent summary plus key messages?
- Which approval actions matter most in the first mobile release?
- What official notification mechanisms are realistic for re-engagement?

---

## 15. Decision Summary

Use a **Mini Program** as MiraChat's official user-facing surface inside the WeChat ecosystem when the goal is visibility, approvals, summaries, and user-initiated AI workflows. It should complement official transport adapters like WeCom, not replace the product core.
