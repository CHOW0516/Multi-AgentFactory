# Desktop pages (P4)

Every screen except the two isometric ones (P5). Built on P1's shell: pages are found automatically
from `src/pages/*/route.tsx`, and global pieces from `src/global/*/index.tsx`.

Run with mock data: `cd desktop && VITE_USE_MOCKS=true npm run dev:web`. Log in with any seeded email
(`manager@`, `sales@`, `planner@`, `store@`, `qc@`, `admin@factory.local`) and any password.

## Pages and roles (admin can open everything)

| Page | Path | Roles | What it does |
|---|---|---|---|
| Login | `/login` | everyone | Email and password. The token goes to the OS secure store; you return to the page you came from. |
| Approvals | `/approvals` | manager | Inbox sorted by due date, time waiting, and a reminder badge. Waiting / decided / cancelled tabs. |
| Approval pack | `/approvals/:approvalId` | manager | PO beside extracted fields (low confidence in red, corrections show who made them), PO vs quotation, material table, plan option cards (Recommended tag), schedule impact Gantt, draft customer message, and a "What changed" banner on re-plans. Approve option / Reject (reason required) / Ask orchestrator. |
| Orders | `/orders` | manager, sales, planner | Filters (search, status, customer, due by, late risk). Upload PO (drag and drop, file picker, desktop dialog). |
| Order detail | `/orders/:orderId` | manager, sales, planner | Status, PO viewer, field check (only flagged fields editable; sales and manager), lines, plan, customer reply with "Mark as sent" (sales), timeline. |
| Schedule | `/schedule` | manager, planner | Read-only Gantt by machine: locked, tentative and done slots, overtime, maintenance and breakdowns, a now-line. Click a slot to open its order. |
| Materials | `/materials` | manager, planner, store | Stock with warnings, holds, shortages and purchase requests, cycle count (store). Record movement (store). |
| Material detail | `/materials/:materialId` | manager, planner, store | Totals, movement history, and the movement form (store). |
| Quotations | `/quotations` | manager, sales | List, create and edit. "Can we make this date?" what-if, both on a quotation and inside the form. |
| Dashboards | `/dashboards` | manager, planner | KPI tiles and 7 charts with a date range. Each chart has a table view. |
| Quality | `/quality` | manager, qc | Orders in production, checklist per order with pass or fail and a measured value, and missing-check alerts. |
| History | `/history` | manager | Audit search (text, user or agent, record type, dates), before/after diff, CSV export. |
| Settings | `/settings` | admin | Users and roles, backup approver, machines (including floor x and y), shifts, holidays, business rules, and demo reset (demo mode only). |

**The store role never sees prices.** `Money` renders nothing for store users, and price columns and tiles are hidden.

## Global pieces
- **chat:** the chat button in the top bar, or "Ask orchestrator", opens a side panel that stays open while you work. Replies stream in, tool use shows as chips, and the panel remembers which order it is about. Enter sends; Stop cancels.
- **notifications:** a bell with the unread count and a list, where clicking marks an item read and opens its link. Live events show a toast and a native desktop notification.
- **live-refresh:** `order_state_changed`, `approval_created` and `machine_status_changed` events invalidate the affected queries.

## Building blocks (`src/components/`)
`DataTable` (sticky header, sort, loading/error/empty), `QueryState`, `Dialog`/`ConfirmDialog`/`Drawer`, `PdfViewer` (Chromium's built-in viewer in an iframe), `MiniGantt`, `StatusBadge`, `KpiTile`, `Money`, `PageHeader`, role helpers, format helpers, `chat-store`, and shared `mock-data.ts` plus `mocks.ts` (8 machines, 10 customers, orders in every state; mocks change the data in place).

**Chart colours:** two series colours per theme, checked with the dataviz validator for colour-blind separation on both surfaces. Every chart also has a table view.

## Edge cases handled
- **No data yet:** no plan or reply yet (404) shows a friendly empty text, not an error. Every list has an empty state, and every query has an error state with Retry.
- **Approval no longer waiting:** an approval that is decided or cancelled opens read-only, with no buttons. A second decision returns 409, and the error is shown.
- **Reject:** cannot be sent without a reason; the comment is trimmed.
- **Field check:** sends only the fields you changed, then confirms. Read-only for roles that can't check.
- **Movements:** a code that doesn't exist, a quantity that is zero or text, or an issue/scrap/adjust-out that is more than the stock is rejected. Scrap and adjust need a reason; receive needs a reference. Codes match any case (barcode scanners), and Enter after a scan jumps to quantity.
- **Cycle count:** shows the difference against system stock before saving, and lists the oldest counts first.
- **Upload:** only PDF or image files up to 20 MB.
- **Date ranges:** "from" after "to" shows a message instead of a request (schedule, dashboards). Shift end must be after start.
- **Notifications:** ones meant for other users are ignored; toasts stack up to 3 and disappear after 6 seconds.
- **Unexpected list shapes:** a plain array or `Page<T>` both work; anything else is treated as empty, never a crash.
- **Accessibility:** works at 1280×800. Keyboard: rows open with Enter, Escape closes dialogs, drawers and chat, and focus moves into dialogs. Loading pulses stop when reduced motion is on.

## Tests (`desktop/tests/pages/`, 35 tests)
- **Approval pack:** renders every section; approves the recommended option or the chosen one; shows "What changed" on a re-plan; Ask orchestrator works.
- **Reject:** needs a reason, and sends the reason with the trimmed comment.
- **Inbox:** sorted by due date (no date last), then by time waiting.
- **Field check:** only flagged fields can be edited; it sends only changed fields; it is read-only outside field-check mode. Order filters build the right query.
- **Movements:** validation rules, signs, case-insensitive codes, form errors, and scanner Enter.
- **Prices:** the store role sees no unit cost; the manager does.
- **Chat:** streams with tool chips, shows a message when it fails, and splits tool lines.
- **Notifications:** toast plus native notification on a live event; ones for other users are ignored.
- **Live refresh:** invalidates the right query keys.
- **Sidebar by role:** store, qc, sales, manager and admin each see the right pages; detail pages never show.
- **Other:** chart rows, history diff and query, and QC missing-check rules.
