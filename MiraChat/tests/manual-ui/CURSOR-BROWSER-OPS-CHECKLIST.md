# Ops console — Cursor Browser (MCP) checklist

Use this when **“test in UI”** means the **Cursor Browser MCP** (`browser_navigate`, `browser_snapshot`, `browser_click`, …), not Playwright.

**URL:** `http://127.0.0.1:4473/?api=http://127.0.0.1:4400` (adjust API port).

**Before testing:** API + static server running; rebuild ops console after HTML changes (`npm run build --workspace @delegate-ai/ops-console`).

## Preconditions

1. Navigate to the URL above.
2. If the **settings drawer** is open: click **Close settings drawer** (× in drawer header) or press **Escape** until the main chat + composer are visible.
3. Resize the browser wide (~1200px+) if the layout collapses to a narrow column.

## Sidebar & chrome

| Step | Action | Happy path | Unhappy / edge |
|------|--------|------------|----------------|
| S1 | **Measurement dashboard** | Opens measurement tab/window (may be new tab). | Blocked pop-ups / offline API. |
| S2 | **Menu (☰)** | Opens settings drawer. | — |
| S3 | **Close settings drawer** | Drawer closes; composer reachable. | If stuck, Escape + scroll × into view. |
| S4 | **SEARCH DM/CONTACT** | Typing filters thread list. | No matches → empty list OK. |
| S5 | **Search only open chat** | Toggle when enabled. | Disabled when no thread selected (expected). |
| S6 | **Generate replies for queue** | Enabled when pending &gt; 0; toast on success. | Disabled when caught up (expected). |
| S7 | **New chat (+)** | Clears selection / new conversation flow. | — |

## Drawer tabs (open Menu first)

| Step | Tab | Happy path | Unhappy |
|------|-----|------------|---------|
| D1 | **Connection** | QR / status visible; **Save & reconnect** saves. | Invalid API base → error banner/toast. |
| D2 | **Metrics** | Panel loads after approvals (may show empty). | API error → loading stops with error. |
| D3 | **Audit** | Log lines after user actions. | Empty if no events. |
| D4 | **Identity** | **Save identity** toast. | Validation if fields required. |
| D5 | **Relationship** | **Save relationship** toast. | — |
| D6 | **Desktop** | Ingest UI visible. | Missing thread id → toast (when applicable). |

## Composer & thread actions (drawer closed)

| Step | Action | Happy path | Unhappy |
|------|--------|------------|---------|
| C1 | **Thread or recipient id** field | Fill before simulate send. | — |
| C2 | **Simulated message** textarea | Enter text. | Empty + **Send** → no send (expected). |
| C3 | **Send** | Inbound queued; draft may appear after worker. | API down → error. |
| C4 | **+ (More chat actions)** | Menu opens. | — |
| C5 | **Find meeting times** | Modal opens when a thread is selected; fill **Their message** → **Suggest times**. | No thread → “Select a thread first”; empty message → “Add their message first”. |
| C6 | **Summarize thread** | Summary modal when thread selected. | No thread → no-op. |
| C7 | **Refresh** | Reloads threads/drafts. | — |
| C8 | **Import to memory → Upload** | File picker (agent may not complete file choose). | — |
| C9 | **Cycle delegation mode (⇄)** | Pill cycles suggest / review / auto (with thread). | No thread → no-op. |
| C10 | **Back (←)** | Clears thread (mobile). | — |

## Modals

| Step | Modal | Happy | Unhappy |
|------|-------|-------|---------|
| M1 | **Find a time together** | **Close scheduling** or Escape closes. | Run without message → toast. |
| M2 | **Thread summary** | **Close summary** or Escape closes. | — |
| M3 | **Import — full detail** | **Close import** closes. | — |

## Mission / copy sanity (visible without clicks)

- **PROXY SELF** / mission strip and **Private to you** lines present.
- No user-facing **inbound/outbound** in main chrome (summaries may still use plain language from the model).

---

**Note:** MCP snapshots only include interactive nodes the browser exposes; after UI changes, run `npm run build --workspace @delegate-ai/ops-console` so `serve` picks up new `aria-label`s and `modal[hidden]` behavior.
