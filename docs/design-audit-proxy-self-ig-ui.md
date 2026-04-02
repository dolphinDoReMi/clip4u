# Design Audit — Proxy Self UI

| Field | Value |
| --- | --- |
| Product | MiraForU / Proxy Self / MiraChat |
| Audit focus | Make the product **function like WhatsApp** and **look like Instagram DM** |
| Surfaces audited | `apps/ops-console`, `apps/ops-console/measurement`, `apps/mini-program` |
| Status | Draft working spec |

---

## 1. Design directive

The product should split UX direction into two layers:

- **Behavioral model:** **WhatsApp**
- **Visual model:** **Instagram DM**

This means:

- Users should immediately understand the product as a familiar **chat inbox and thread** workflow.
- The brand should feel more **editorial, personal, and premium** than a generic productivity dashboard.
- Approval, policy, and automation should feel like **native chat affordances**, not a separate ops tool.

---

## 2. Surface inventory

| Surface | Current file | Product role |
| --- | --- | --- |
| Ops console inbox + thread | `MiraChat/apps/ops-console/src/index.html` | Primary messaging surface |
| Measurement dashboard | `MiraChat/apps/ops-console/src/measurement.html` | PMF, trust, and research analytics |
| Mini-program shared shell | `MiraChat/apps/mini-program/app.wxss` + `app.json` | Mobile lightweight inbox / draft actions |

---

## 3. Functional requirements: WhatsApp-like

The product should behave like WhatsApp in the following ways:

| Area | Requirement |
| --- | --- |
| **Inbox IA** | Conversation list is the default entry point. Threads are sorted by recency, searchable, and show preview text, timestamp, and unread or pending state. |
| **Thread IA** | The active thread is the main work surface, with header, message history, draft state, and composer in one vertical flow. |
| **Message semantics** | Inbound and outbound messages are always visually distinct, with clear alignment, timestamps, and conversational rhythm. |
| **Mobile behavior** | On mobile, list view and thread view should behave as separate states with a clear back action. |
| **Composer behavior** | The composer stays anchored at the bottom and remains the primary action area. |
| **Status affordances** | Connection, health, and mode should appear as lightweight thread metadata, not as large system banners unless degraded. |
| **Approval UX** | Draft approval belongs inline with the thread and must feel like "review before sending a WhatsApp reply," not like processing a ticket. |
| **Secondary tools** | Settings, identity, audit, and metrics should not compete with the inbox for primary attention. |

---

## 4. Visual requirements: Instagram-like

The product should look like Instagram DM in the following ways:

| Area | Requirement |
| --- | --- |
| **Palette** | Dark base with warm pink, orange, and purple accents. Avoid WhatsApp green as the primary brand signal. |
| **Avatars** | Use story-ring or gradient ring treatment for identity anchors. |
| **Controls** | Buttons, pills, tabs, and search fields should be rounded and soft, not square admin controls. |
| **Elevation** | Use subtle blur, glow, and layered surfaces rather than flat panels everywhere. |
| **Typography** | Strong, clean sans-serif hierarchy with compact, high-contrast labels. |
| **Primary CTA** | Use gradient treatment for the primary action. |
| **Density** | Keep chat surfaces lightweight; reserve higher density for analytics and audit surfaces. |
| **Brand consistency** | Dashboard and mini-program should share the same tokens and shape language as the inbox. |

---

## 5. UI audit by element

### 5.1 Inbox and thread shell

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| App shell | Two-pane desktop, single-pane mobile | Dark immersive shell with soft gradients | Updated in current web console |
| Sidebar | Inbox-first navigation | Elevated dark rail with subtle separation | Updated |
| Search field | Always visible at top of inbox | Rounded pill search | Updated |
| Thread rows | Tap or click directly into thread | IG-like avatar ring, tighter type, muted preview | Updated |
| Active thread state | Clear selected conversation | Strong accent edge or filled active state | Updated |
| Empty state | Encourage selecting a conversation | Calm branded empty state, not developer placeholder | Partially updated |

### 5.2 Thread header

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Back button | Visible on mobile only | Circular icon button | Updated |
| Avatar | Identity anchor | Story-ring treatment | Updated |
| Thread title | Main thread identity | Stronger type, compact hierarchy | Updated |
| Status pills | Show health, connection, and mode | Small pills with accent-coded states | Updated |
| Mode switch | Present but secondary | Icon button aligned with header chrome | Updated |

### 5.3 Message stream

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Day label | Break long histories into digestible groups | Floating pill label | Updated |
| Inbound bubble | Left-aligned, easy to scan | Dark elevated bubble | Updated |
| Outbound bubble | Right-aligned, easy to scan | Gradient bubble, brighter than inbound | Updated |
| Timestamp | Always visible but low-noise | Muted micro-type | Updated |
| Scroll rhythm | Preserve conversational pacing | Slightly roomier spacing than raw log output | Updated |

### 5.4 Approval and delegation controls

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Approval panel | Inline with thread, above composer | Same chat surface language, not separate admin card | Updated |
| Draft summary blocks | Easy comparison of inbound vs draft vs options | Rounded cards with color-coded left accent | Updated |
| Option actions | Approve specific option quickly | Pill buttons with clear priority order | Updated |
| Reject and edit actions | Present but less visually dominant than approve | Secondary or danger pills | Updated |
| Pending queue | Visible only when relevant | Small inline status chips near composer | Updated |

### 5.5 Composer and primary actions

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Composer input | Persistent at bottom of thread | Large rounded text field | Updated |
| Send button | One-tap primary action | Gradient primary button | Updated |
| Secondary action row | Nearby but clearly subordinate to send | Rounded secondary pills | Updated |
| Placeholder copy | Should feel like a real DM workflow | Chat-like copy, not system-test phrasing | Partially updated |

### 5.6 Secondary surfaces in console

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Settings drawer | Secondary layer, not new page | Blurred sheet with consistent tokens | Updated |
| Tabs | Quick switching between utility areas | Capsule tabs | Updated |
| Form fields | Clear and compact | Rounded elevated fields | Updated |
| QR block | Only shown when required | Branded framed panel | Updated |
| Toasts | Short-lived and non-blocking | Rounded floating toast | Updated |
| Error banner | Only for degraded state | Use sparingly; keep inline errors lightweight | Updated |
| Modals | For assist and negotiation only | Rounded cards with same brand language | Updated |

### 5.7 Measurement dashboard

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| Top bar | Clear page identity and return path to inbox | Same dark gradient shell | Updated |
| Action buttons | Refresh and open console clearly visible | Pill buttons, gradient primary | Updated |
| Filter controls | Compact analytics filters | Rounded glass fields | Updated |
| Metric cards | Fast scan of key PMF numbers | Elevated cards using shared tokens | Updated |
| Chart legend and series | Clear mapping to data | Accent palette aligned with IG system | Updated |
| Event list | Dense but readable | Softer borders, mono for ids only | Updated |
| Feedback score buttons | Quick research input | Rounded selection chips | Updated |

### 5.8 Mini-program shared UI

| Element | Desired behavior | Desired visual treatment | Status |
| --- | --- | --- | --- |
| App background | Same brand system as web | Dark IG-style background | Updated |
| Cards | Lightweight mobile containers | Rounded elevated cards | Updated |
| Pills | Shared status vocabulary | Pink-accent capsule pills | Updated |
| Buttons | Clear primary, secondary, danger semantics | Gradient primary, muted secondary, soft danger | Updated |
| Inputs | Comfortable mobile text entry | Rounded elevated fields | Updated |
| Navigation bar | Consistent app chrome | Darker brand-aligned bar | Updated |

---

## 6. Remaining gaps

These items still need follow-through beyond the first styling pass:

- Replace remaining demo-oriented copy with product-grade DM language across all interactive states.
- Add richer WhatsApp-like thread metadata where relevant, such as unread count semantics and clearer send-state language.
- Ensure any future attachments, voice notes, media previews, and contact cards inherit the same IG-style token system.
- Audit future pages under `apps/mini-program/pages/**` once they are added, since the current mini-program surface is only a shared-style scaffold.
- Keep analytics density controlled so the measurement dashboard remains on-brand without pretending to be the main chat product.

---

## 7. Acceptance checklist

- A first-time user should read the web console as a familiar messaging inbox without explanation.
- The product should no longer visually read as WhatsApp green, terminal tooling, or a generic admin dashboard.
- Approval flow should feel like reviewing a reply inside a DM thread, not processing back-office work.
- Dashboard and mini-program should look like members of the same product family as the inbox.
- New UI work should be checked against this audit before adding one-off colors, shapes, or spacing rules.

---

## 8. Related docs

- PRD summary: [PRD-proxy-self-1-pager.md](./PRD-proxy-self-1-pager.md)
- Full PRD: [PRD-MiraForU.md](./PRD-MiraForU.md)
- System design: [system-design-proxy-self.md](./system-design-proxy-self.md)
