# Master Prompt: Build the Factory Order-to-Commitment System

> Paste everything below this line into Claude Code (with the **Anatomy** skill available) in an empty repository.

---

## 0. Your role and how to work

You are a senior full-stack engineer. Build a **desktop application plus a backend** for a multi-agent AI system that helps a small/medium contract manufacturer go from "customer PO received" to "manager-approved, scheduled order" with **one** manager approval.

How to work:
1. **Plan first.** Before writing code, write `docs/PLAN.md`: folder layout, data model, message types, build order, and any question you have. Stop and wait for my approval.
2. Build in the phases in section 12. Each phase must run end to end and pass its tests before the next one starts.
3. Use only the dependencies listed in section 3. Ask before adding any other.
4. Keep it simple. Do not build for features that are not in this prompt.
5. Use clear names. No single-letter variables or unclear abbreviations.
6. After each phase, list edge cases and the tests that cover them.
7. Communicate in simple English.

---

## 1. Problem (context for you)

Small contract manufacturers (CNC machining, sheet metal, injection moulding job shops, 20–200 staff) take hours to days to answer "can we deliver this order by the due date?". Order data, stock, and machine capacity are in different places and checked by hand. Results: late deliveries, surprise overtime, retyping errors, shortages found too late, and managers deciding without seeing the impact on other orders.

## 2. Solution (what you are building)

When a PO arrives, the system:
1. Reads the PO itself (PDF, Word, Excel, scan, email body) and extracts the order.
2. Compares it to the quotation that sales already agreed with the customer.
3. Checks material in the database and places a temporary hold.
4. Plans the schedule with an optimization solver and simulates **what happens if we confirm**.
5. If the due date cannot be met, suggests the earliest realistic date and other options.
6. Sends **one approval pack** to the manager.
7. After approval, re-checks, locks the plan, and drafts the customer reply for sales to send.

The desktop app shows a **virtual factory** (isometric, interactive), dashboards, order history, an approval inbox, a chat with the orchestrator, and a live **agent map**.

---

## 3. Tech stack

### Backend (Python 3.12)
| Purpose | Library |
|---|---|
| API server | FastAPI + Uvicorn |
| Data models / validation | Pydantic v2 |
| Database access | SQLAlchemy 2 (async) + asyncpg |
| Migrations | Alembic |
| Message queue client | aio-pika (RabbitMQ) |
| LLM | `anthropic` official Python SDK |
| Scheduling solver | Google OR-Tools (CP-SAT) |
| Word / Excel reading | python-docx, openpyxl |
| PDF / images | Send directly to Claude (native PDF and image input). No separate OCR library. |
| Email intake | Python `imaplib` (stdlib) for IMAP. Microsoft Graph is a later option. |
| Auth | PyJWT + passlib[bcrypt] |
| Tests | pytest, pytest-asyncio, httpx |
| Lint / format | ruff |

### Infrastructure
| Purpose | Tool |
|---|---|
| Database | PostgreSQL 16 |
| Message queue | RabbitMQ 3 (with management UI) |
| Dev email server | GreenMail (SMTP + IMAP, to test PO intake; Mailpit has no IMAP) |
| Local run | Docker Compose |

### Desktop app (TypeScript)
| Purpose | Library |
|---|---|
| Desktop shell | Electron |
| Build | Vite + electron-builder (Windows `.exe` installer and macOS `.dmg`) |
| UI | React 18 + TypeScript |
| Routing | React Router |
| Server data | TanStack Query |
| Local UI state | Zustand |
| Charts | Recharts |
| Isometric factory and agent map | **Anatomy** skill kit (`kit/iso-kit.ts`, `kit/react/draw.tsx`, `kit/react/live.tsx`, `kit/iso.css`) copied into `desktop/src/iso/` |
| Tests | Vitest + React Testing Library; Playwright (Electron mode) for end-to-end |

**Why Anatomy and not Simulab:** Anatomy builds interactive isometric SVG figures with a React kit, so it fits inside an app page and can be driven by live data. Simulab produces a standalone lab page and a video, which suits explainers, not a live app screen.

---

## 4. Architecture

```
          Desktop app (Electron + React)
          Manager / Sales / Store / Planner
                    │  REST (HTTPS) + WebSocket
                    ▼
        ┌──────────────────────────┐
        │  API + Orchestrator      │  FastAPI; workflow state machine
        │  (orchestrator service)  │  state stored in PostgreSQL
        └────────────┬─────────────┘
                     │  RabbitMQ (tasks + results + events)
   ┌────────┬────────┼─────────┬──────────┬───────────┬────────────┐
   ▼        ▼        ▼         ▼          ▼           ▼            ▼
 Order   Material  Planning  Quality  Monitoring  Maintenance  Simulator
 agent    agent     agent    agent     agent        agent      (demo only)
   │        │        │         │          │           │            │
   └────────┴────────┴────┬────┴──────────┴───────────┴────────────┘
                          ▼
                   PostgreSQL 16 (single source of truth)
```

Rules:
- **Hub and spoke.** Agents never talk to each other directly. Every task goes from the orchestrator to an agent and every result comes back to the orchestrator.
- **The database is the source of truth.** Messages carry IDs, not copies of large data.
- **Each agent is its own process** (own Docker service) consuming its own RabbitMQ queue.
- **The orchestrator is restart-safe.** All workflow state is in the `workflow_runs` table. On restart it resumes every run that is not finished.
- **The desktop app is a client only.** It talks to the backend over REST and WebSocket. It stores no business data locally. The backend runs on a factory server or cloud VM so manager, sales, and store share the same data.

---

## 5. Repository layout

```
/backend
  /app
    /api            # FastAPI routers (auth, orders, approvals, materials, machines, schedule, agents, chat, history, dashboard)
    /core           # config, db session, security, logging
    /models         # SQLAlchemy models
    /schemas        # Pydantic schemas, incl. message envelope
    /messaging      # RabbitMQ publish/consume helpers, retry, dead-letter
    /orchestrator   # state machine, approval pack builder, chat
    /agents
      /order
      /material
      /planning
      /quality
      /monitoring
      /maintenance
    /llm            # one Claude client wrapper, prompts, tool definitions, cost tracking
    /simulator      # demo data + fake POs + fake machine events
  /migrations
  /tests
/desktop
  /electron         # main process, preload (contextIsolation on, no nodeIntegration)
  /src
    /iso            # Anatomy kit copy
    /figures        # factory floor figure, machine figures, agent map figure
    /pages
    /components
    /api            # typed REST + WebSocket client
  /tests
/docs
  PLAN.md
  ARCHITECTURE.md
  RUNBOOK.md        # start, stop, backup, restore
docker-compose.yml
.env.example
```

---

## 6. Data model (PostgreSQL)

Create these tables with Alembic. Use UUID primary keys, `created_at`, `updated_at`, and `created_by` on business tables.

| Table | Key fields |
|---|---|
| `users` | name, email, password_hash, role (`manager`, `sales`, `planner`, `store`, `qc`, `admin`), backup_approver_id |
| `customers` | name, code, email, address |
| `parts` | part_number, revision, description, customer_id |
| `bom_lines` | part_id, material_id, quantity_per_part, scrap_rate |
| `routings` | part_id, step_number, machine_type, setup_minutes, cycle_seconds_per_part |
| `quotations` | customer_id, part_id, quantity, unit_price, quoted_due_date, status |
| `materials` | code, name, unit, min_stock, last_counted_at |
| `suppliers` / `supplier_items` | supplier, material_id, lead_time_days |
| `stock_movements` | material_id, quantity (+/-), type (`receive`, `issue`, `scrap`, `return`, `adjust`), reference, user_id. **Stock = sum of movements.** Never store a stock number that someone overwrites. |
| `stock_holds` | material_id, order_id, quantity, type (`temporary`, `firm`), expires_at |
| `purchase_requests` | material_id, quantity, needed_by, status |
| `machines` | code, name, machine_type, status (`running`, `idle`, `setup`, `down`, `maintenance`), position_x, position_y (for the factory floor) |
| `shifts` / `holidays` | working calendar |
| `orders` | customer_id, po_number, status, due_date, promised_date, source_document_id, quotation_id |
| `order_lines` | order_id, part_id, quantity, unit_price |
| `source_documents` | file path, mime type, raw email headers |
| `extracted_fields` | order_id, field_name, value, confidence (0–1), source_page, source_text, corrected_value, corrected_by |
| `schedule_slots` | order_id, machine_id, routing_step, start_at, end_at, status (`tentative`, `locked`, `done`) |
| `plan_options` | order_id, option_type (`as_requested`, `delay`, `split`, `overtime`, `move_other_order`), finish_date, extra_cost, impacted_orders JSON, explanation |
| `approvals` | order_id, approver_id, decision (`approve`, `reject`, `choose_option`, `question`), chosen_option_id, comment, decided_at |
| `workflow_runs` | order_id, state, attempt_counts JSON, last_error, next_timeout_at |
| `agent_messages` | message_id, order_id, from_agent, to_agent, type, action, status, payload JSON, latency_ms, tokens_in, tokens_out, cost_usd |
| `customer_messages` | order_id, draft_text, status (`draft`, `sent_by_sales`) |
| `qc_plans` / `qc_records` | order_id, check name, result, inspector_id |
| `machine_events` | machine_id, event_type, value, at |
| `maintenance_events` | machine_id, type (`breakdown`, `planned`), start_at, end_at, note |
| `audit_log` | user_id or agent, action, entity, entity_id, before JSON, after JSON, at |

---

## 7. Agents: job scopes

Rule: **use the LLM only where reading or reasoning is needed. Use normal code for counting, checking, and calculating.**

### 7.0 Orchestrator (main agent) — code state machine + Claude
- The only agent users talk to (chat panel + approval inbox).
- Order workflow states:
  `RECEIVED → EXTRACTED → NEEDS_FIELD_CHECK → VERIFIED → MATERIAL_CHECKED → PLANNED → WAITING_APPROVAL → RECHECKING → CONFIRMED → REPLY_DRAFTED → CUSTOMER_REPLIED`
  plus `REJECTED`, `DECLINED`, `FAILED`, `REPLAN_NEEDED`.
- Sends tasks, waits for results, decides the next step. Timeouts and retries per task. After the retry limit, mark `FAILED` and notify a person.
- Builds the **approval pack** (section 8).
- Chat: answers questions like "why is SO-0412 late?" or "what if we take 500 more pcs next week?" using **Claude tool use**. Tools are read-only REST calls (get order, get stock, get schedule, run what-if plan). The chat can never approve, reserve, or send anything by itself.
- Approval timeout: reminder after `APPROVAL_REMINDER_HOURS`, then escalate to the backup approver.

### 7.1 Order agent — Claude + code
- Polls the IMAP mailbox every `EMAIL_POLL_SECONDS`. Also accepts drag-and-drop upload in the app.
- Sends PDF and images straight to Claude. Converts Word/Excel to text first.
- Extracts with a strict JSON schema (use Claude tool use with an input schema): customer, PO number, lines (part number, revision, quantity, unit price), due date, delivery address, notes. Each field has `confidence` and `source_text`.
- Matches customer and part to master data. Compares with the quotation. Any field with confidence below `EXTRACTION_CONFIDENCE_THRESHOLD`, or any mismatch with the quotation, sets `NEEDS_FIELD_CHECK`. Sales then fixes only those fields in the app.
- Detects a revised PO (same PO number from the same customer) and triggers `REPLAN_NEEDED`.
- Drafts customer replies (confirm / new date / split delivery). **Never sends email to customers.** Sales sends.

### 7.2 Material agent — code
- Explodes the BOM (including scrap rate).
- Available = sum(movements) − firm holds − unexpired temporary holds of other orders.
- Places temporary holds with expiry `HOLD_EXPIRY_HOURS`. Converts to firm on confirm. Releases on reject or expiry (background job).
- Finds shortages and the material ready date from supplier lead times. Drafts purchase requests after approval.
- Flags data quality: negative stock, material not counted in `STOCK_COUNT_WARNING_DAYS`.
- All hold changes run in a database transaction with row locks, so two orders can never hold the same stock.

### 7.3 Planning agent — OR-Tools + Claude for explanations
- Inputs: routings, machines by type, shifts, holidays, maintenance windows, existing locked slots, material ready date.
- **Handles one order at a time** (single consumer on its queue).
- Builds options with CP-SAT:
  - `as_requested`: meet the due date if possible.
  - `delay`: earliest date for the full order.
  - `split`: part quantity by due date, rest later.
  - `overtime`: meet due date with extra hours (cost = hours × `OVERTIME_RATE_PER_HOUR`).
  - `move_other_order`: meet due date by shifting lower-priority orders; list every moved order and whether it still meets its own due date.
- Earliest date = later of (material ready date, first fitting machine slot) + run time + `QC_BUFFER_HOURS` + `SHIPPING_BUFFER_DAYS`.
- For each option: finish date, machine load, overtime hours, extra cost, estimated margin, impacted orders.
- Claude writes a short plain-English explanation of each option from the numbers. It never changes the numbers.
- Only this agent writes to `schedule_slots`.

### 7.4 Quality agent (phase 3) — code
- Builds a QC plan per order (first-piece check, sampling, measurements).
- Records results from the app. Flags missing or failed checks. Blocks order completion if records are missing.

### 7.5 Monitoring agent (phase 4) — code
- Phase 4a: reads manual machine status and output entered in the app.
- Phase 4b (later): reads machine data via OPC UA or MQTT through an adapter interface. Build the interface, not a real PLC connection.
- Compares progress to plan. Raises `order.behind_schedule` events.

### 7.6 Maintenance agent (phase 4) — code
- Records breakdowns and planned maintenance. Publishes `machine.unavailable` so the orchestrator can ask the Planning agent to re-plan and the manager to approve the change.

### 7.7 Simulator (demo mode only) — code
- Enabled only when `APP_MODE=demo`.
- Seeds a realistic factory: 6–8 machines (CNC lathe ×2, CNC mill ×2, press brake, laser cutter, QC station, packing), 10 customers, 40 parts, 30 materials, 3 months of history.
- Every `SIM_PO_INTERVAL_SECONDS` emails a generated PO PDF to GreenMail.
- Generates machine status changes, output counts, and an occasional breakdown.
- Lets the whole app be demonstrated with no real factory.

---

## 8. Approval pack (what the manager sees)

One screen per order:
1. Original PO (PDF viewer) side by side with extracted fields. Low-confidence or corrected fields highlighted, with who corrected them.
2. Quotation comparison (price, quantity, revision, date).
3. Material: needed, available, held, short, arrival date, "last counted" date.
4. Plan options as cards. Each shows finish date, overtime, extra cost, margin, impacted orders, and the AI explanation. One is marked recommended.
5. Mini Gantt showing the new order and the orders that move.
6. Draft customer message for the chosen option.
7. Buttons: **Approve option**, **Reject** (reason required: re-plan / counter-offer / decline), **Ask orchestrator** (opens chat with this order as context).

After approval the orchestrator runs **RECHECKING**: confirm holds and slots are still valid. If anything changed, go to `REPLAN_NEEDED` and show the manager what changed.

---

## 9. Communication between services

### 9.1 Transports
| Transport | Used for |
|---|---|
| REST over HTTPS (FastAPI) | Desktop app ↔ backend; Claude tools in chat call internal read-only endpoints |
| WebSocket (`/ws`) | Push to the app: new approval, order state change, machine status, agent message (for the agent map animation) |
| RabbitMQ | Orchestrator ↔ agents. Topic exchange `factory`. Queues `agent.order`, `agent.material`, `agent.planning`, `agent.quality`, `agent.monitoring`, `agent.maintenance`, `orchestrator.results`, `events`. Each has a dead-letter queue. |
| PostgreSQL | Shared state |
| IMAP | PO intake |

### 9.2 Message envelope (Pydantic model, used by every message)
```json
{
  "message_id": "uuid",
  "correlation_id": "uuid of the workflow run",
  "order_id": "SO-2026-0412",
  "type": "task | result | event",
  "from_agent": "orchestrator",
  "to_agent": "material",
  "action": "check_and_hold",
  "payload": {},
  "status": "ok | partial | failed",
  "notes": "free text from the LLM, never used as data",
  "attempt": 1,
  "reply_by": "ISO-8601",
  "sent_at": "ISO-8601"
}
```

### 9.3 Rules
- Validate every message against its schema on receive. Reject invalid ones to the dead-letter queue.
- **Idempotent:** store processed `message_id`s. A repeated message must not create a second hold or slot.
- Every message is also written to `agent_messages` and pushed to the WebSocket, so the app can show history and animate the agent map.
- Record `latency_ms`, tokens, and cost on every LLM call.

---

## 10. Desktop app: UI

### 10.1 Look and feel
- **Light, clean theme** by default (Anatomy light theme, `data-theme="light"`), with a dark theme toggle.
- Quiet neutral palette. One accent colour for "needs action". Status colours only for machine status (running green, idle grey, setup amber, down red, maintenance blue).
- Left sidebar navigation, top bar with search, notifications, user menu. Orchestrator chat as a slide-out panel on the right, available from every page.
- Respect reduced motion. Animations stop when a page is not visible.

### 10.2 Pages

**1. Factory floor (home)** — built with the Anatomy skill
- An isometric, highly detailed factory floor: concrete base with floor markings, each machine as a real-looking isometric machine (lathe, mill, press brake, laser cutter, QC bench, packing table), material racks, a store area, a small office with the manager's desk.
- Each machine has a **status light (stack light)** that matches its live status, and a small display on its face showing the current order and part count.
- Running machines have calm motion (spindle turning, laser head moving). A machine that is down has its red light pulsing.
- Material moves as small carts/pallets along the floor path when stock is issued.
- **Hover** a machine: highlight and a tooltip readout. **Click**: right-side drawer with machine details (status, current and next jobs, today's utilisation, recent events, maintenance history) and actions for authorised roles (set status, log breakdown).
- Bottom-right live readout: machines running / total, orders in production, pending approvals.
- Scope note for Anatomy: treat this as a **Hero** figure (one floor, 6–8 machines). Build the machines as reusable sub-figures so the floor is composed, not drawn as one giant figure. Use SVG; WebGL only for a soft light glow on stack lights if it helps.

**2. Agent map** — built with the Anatomy skill
- The hub-and-spoke from section 4, drawn as a clean isometric "control room": the Orchestrator as a central console, each agent as a small station around it, RabbitMQ as a conveyor/rail ring between them, PostgreSQL as a cabinet/vault below.
- **Lines animate when work happens:** when a task is sent, a small token travels along the line from orchestrator to the agent; the result travels back. Colour or shape shows `task`, `result`, `event`, `failed`. Driven by live WebSocket `agent_message` events.
- Each station shows a small live counter (tasks in queue, in progress).
- **Click an agent:** drawer with its job scope (from section 7), uses-LLM yes/no, current tasks, last 50 messages (expandable JSON), success rate, average latency, tokens and cost today, queue depth, dead-letter count.
- Click a line: recent messages on that link.
- A "replay order" control: pick an order and replay its message flow on the map at 1×/4×.

**3. Approvals inbox** — list of orders waiting, sorted by due date, with time waiting. Opens the approval pack (section 8).

**4. Orders** — table with filters (status, customer, due date, late risk). Order detail page with a **timeline** of every state change, agent message, human action, and the documents.

**5. Schedule** — Gantt by machine (drag is read-only; changes go through the planner and approval). Shows tentative vs locked slots, maintenance windows, today line.

**6. Materials** — stock list (computed from movements), holds, shortages, purchase requests. Forms for receive / issue / scrap / adjust, with barcode scanner input support (scanner acts as keyboard). Cycle count screen.

**7. Quotations** — sales creates and edits quotations. Quick "can we make this date?" check that calls the Planning agent in what-if mode (no holds).

**8. Dashboards** — KPI tiles and charts:
- On-time delivery rate (weekly trend)
- Average time from PO received to approved
- Pending approvals and oldest waiting
- Machine utilisation by machine (today, week)
- Material shortages and purchase requests open
- PO extraction accuracy (share of fields corrected by people)
- Planned vs actual run time
- LLM cost per order and per day
- Dead-letter / failed workflow count

**9. History** — searchable audit log of every action by people and agents, with before/after values. Export CSV.

**10. Quality** (phase 3) — QC plans and checklists per order, results entry, missing check alerts.

**11. Settings** — users and roles, backup approver, machines and floor positions, shifts and holidays, thresholds (from env defaults, editable by admin), demo mode reset.

**12. Login** — email + password. Role decides which pages and buttons appear.

### 10.3 Notifications
- In-app toast and badge for: new approval, approval reminder, order behind schedule, machine down, workflow failed.
- Native desktop notification via Electron for the same events.

### 10.4 Electron security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Only a small typed `preload` API (notifications, open file dialog).
- Store the auth token with Electron `safeStorage`.
- Backend URL from settings, HTTPS required outside `APP_MODE=demo`.

---

## 11. Environment file

Create `.env.example` with every key below and comments. Never commit `.env`. Load with Pydantic `BaseSettings`; fail on start if a required key is missing.

```dotenv
# ---------- App ----------
APP_MODE=demo                     # demo | production
APP_NAME=Factory Commit
APP_TIMEZONE=Asia/Kuala_Lumpur
LOG_LEVEL=INFO
API_HOST=0.0.0.0
API_PORT=8000
CORS_ALLOWED_ORIGINS=app://.,http://localhost:5173

# ---------- Security ----------
JWT_SECRET=change-me-long-random
JWT_EXPIRE_MINUTES=480
ADMIN_EMAIL=admin@example.com      # first admin user, created on first start
ADMIN_INITIAL_PASSWORD=change-me

# ---------- Database ----------
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=factory
POSTGRES_USER=factory
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql+asyncpg://factory:change-me@postgres:5432/factory

# ---------- Message queue ----------
RABBITMQ_URL=amqp://factory:change-me@rabbitmq:5672/
RABBITMQ_DEFAULT_USER=factory
RABBITMQ_DEFAULT_PASS=change-me
TASK_DEFAULT_TIMEOUT_SECONDS=120
TASK_MAX_ATTEMPTS=3

# ---------- LLM (Claude) ----------
ANTHROPIC_API_KEY=
LLM_MODEL_ORCHESTRATOR=claude-opus-5-5
LLM_MODEL_EXTRACTION=claude-sonnet-5-5
LLM_MODEL_EXPLAIN=claude-haiku-5-5
LLM_MAX_TOKENS=4096
LLM_DAILY_COST_LIMIT_USD=20        # stop non-critical LLM calls above this

# ---------- Email intake ----------
IMAP_HOST=greenmail
IMAP_PORT=3143
IMAP_USER=orders@example.com
IMAP_PASSWORD=change-me
IMAP_USE_SSL=false
IMAP_FOLDER=INBOX
EMAIL_POLL_SECONDS=60
DOCUMENT_STORAGE_PATH=/data/documents

# ---------- Business rules ----------
EXTRACTION_CONFIDENCE_THRESHOLD=0.85
HOLD_EXPIRY_HOURS=48
APPROVAL_REMINDER_HOURS=4
APPROVAL_ESCALATION_HOURS=8
QC_BUFFER_HOURS=4
SHIPPING_BUFFER_DAYS=1
OVERTIME_RATE_PER_HOUR=0
CURRENCY=MYR
STOCK_COUNT_WARNING_DAYS=30
PLANNING_SOLVER_TIME_LIMIT_SECONDS=30

# ---------- Demo simulator ----------
SIM_PO_INTERVAL_SECONDS=300
SIM_MACHINE_EVENT_INTERVAL_SECONDS=20
SIM_BREAKDOWN_CHANCE_PER_HOUR=0.05
SIM_RANDOM_SEED=42

# ---------- Backups ----------
BACKUP_PATH=/backups
BACKUP_CRON=0 * * * *              # hourly pg_dump; use managed point-in-time restore in production

# ---------- Desktop app (desktop/.env) ----------
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

---

## 12. Build phases and acceptance

| Phase | Build | Done when |
|---|---|---|
| 0 | Repo, Docker Compose (postgres, rabbitmq, greenmail, api, agents), `.env.example`, Alembic, auth, Electron shell with login and sidebar | `docker compose up` + `npm run dev` shows the logged-in empty app |
| 1 | Data model, simulator seed data, Materials page, stock movements, Quotations page | Stock is correct after receive/issue/scrap; tests for holds and concurrency pass |
| 2 | Order agent (IMAP + upload + extraction), orchestrator state machine, field check screen, Orders page with timeline | A demo PO in GreenMail becomes a verified order; low-confidence fields go to sales |
| 3 | Planning agent (all options), approval pack, recheck, reply draft, Approvals inbox, Schedule page | Full flow PO → approved → reply draft works; two POs at once never double-book |
| 4 | WebSocket, **Agent map** (Anatomy) with live animation and agent drawer, chat panel with tools | Lines animate on real messages; clicking an agent shows live details |
| 5 | **Factory floor** (Anatomy) with live machine status, simulator machine events, machine drawer | Machines change light and display as simulator events arrive |
| 6 | Dashboards, History, notifications | KPIs match database queries in tests |
| 7 | Quality agent + page, Monitoring and Maintenance agents (manual input + adapter interface), re-plan on breakdown | Breakdown creates a re-plan approval |
| 8 | Packaging with electron-builder, RUNBOOK, backup + restore test | Installer runs on a clean Windows machine; restore from backup proven |

### Must-have tests
- PO extraction against 10 sample POs of different layouts (store in `backend/tests/fixtures/pos/`). Mock Claude in unit tests; one optional live test behind a flag.
- Two orders reserving the last stock at the same time: only one gets it.
- Duplicate message delivery creates no duplicate hold or slot.
- Hold expiry releases stock.
- Plan goes stale before approval → recheck triggers re-plan.
- Manager reject paths: re-plan, counter-offer, decline.
- Approval escalation to backup approver.
- Orchestrator restart mid-workflow resumes correctly.
- Agent crash → retry → dead-letter → workflow `FAILED` and user notified.
- LLM daily cost limit stops non-critical calls.
- Role permissions: sales cannot approve; store cannot see prices.
- End to end (Playwright + Electron): demo PO → approve → reply draft visible.

---

## 13. Non-functional rules
- Every human and agent action is written to `audit_log`.
- No customer email is ever sent automatically.
- The factory must keep working if the system is down: RUNBOOK includes a paper fallback and how to enter back-dated movements.
- Backups: hourly `pg_dump` in demo; document point-in-time restore for production and test a restore.
- Do not send more customer data to the LLM than the task needs.
- All times stored in UTC, shown in `APP_TIMEZONE`.

---

## 14. Out of scope for now
Real PLC connections, camera-based QC, worker tracking (NFC, inactivity flags), automatic customer emails, ERP integration, mobile app.

Start with `docs/PLAN.md` and wait for my approval.
