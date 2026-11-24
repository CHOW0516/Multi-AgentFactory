# SHARED CONTRACT (identical in all 5 prompts; do not change it on your own)

## A. The team and the branches

Repository: `https://github.com/CHOW0516/Multi-AgentFactory.git`

| Person | Branch | Area |
|---|---|---|
| P1 | `p1-foundation` then `p1-integration` | Foundation, master data, simulator, end-to-end tests, packaging, **merges everything** |
| P2 | `p2-domain-agents` | Order agent, Material agent, Planning agent, their REST APIs |
| P3 | `p3-orchestrator` | Orchestrator, approvals, chat, WebSocket, dashboards/history APIs, Quality/Monitoring/Maintenance agents |
| P4 | `p4-desktop-pages` | Desktop app pages and global panels (everything except the two isometric pages) |
| P5 | `p5-iso-figures` | Isometric **Factory floor** and **Agent map** pages built with the Anatomy skill |

**Order of work:**
1. P1 builds the foundation on `p1-foundation` and merges it into `main` first. Everyone else waits for this. (It is small: scaffold, models, contracts.)
2. P2–P5 create their branch **from the updated `main`** and work in parallel. P1 continues on `p1-integration`.
3. When all are done, P1 merges in this order: `p1-integration`, `p2-domain-agents`, `p3-orchestrator`, `p4-desktop-pages`, `p5-iso-figures`.

## B. File ownership (the rule that prevents merge conflicts)

**You may only create or edit files inside the paths you own.** If you need a change in a file someone else owns, do not edit it. Write the request in your own `docs/requests/<your-id>.md` and continue with a local workaround inside your own folder.

| Owner | Paths |
|---|---|
| P1 | everything at repo root (`README.md`, `docker-compose.yml`, `.env.example`, `.gitignore`, `ownership.json`), `scripts/`, `e2e/`, `docs/CONTRACT.md`, `docs/MASTER_PROMPT.md`, `docs/RUNBOOK.md`, `docs/foundation.md`, `backend/pyproject.toml`, `backend/requirements.txt`, `backend/Dockerfile`, `backend/alembic.ini`, `backend/migrations/`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/core/`, `backend/app/models/`, `backend/app/schemas/`, `backend/app/messaging/`, `backend/app/llm/`, `backend/app/simulator/`, `backend/app/agents/__init__.py`, `backend/app/api/__init__.py`, `backend/app/api/auth.py`, `backend/app/api/master_data.py`, `backend/app/api/settings.py`, `backend/tests/conftest.py`, `backend/tests/foundation/`, `desktop/package.json`, `desktop/package-lock.json`, `desktop/tsconfig*.json`, `desktop/vite.config.ts`, `desktop/electron-builder.yml`, `desktop/index.html`, `desktop/electron/`, `desktop/src/main.tsx`, `desktop/src/App.tsx`, `desktop/src/shell/`, `desktop/src/api/`, `desktop/src/iso/`, `desktop/src/theme/`, `desktop/tests/setup.ts` |
| P2 | `backend/app/agents/order/`, `backend/app/agents/material/`, `backend/app/agents/planning/`, `backend/app/api/orders.py`, `backend/app/api/materials.py`, `backend/app/api/quotations.py`, `backend/app/api/planning.py`, `backend/tests/domain/`, `docs/domain-agents.md`, `docs/requests/p2.md` |
| P3 | `backend/app/orchestrator/`, `backend/app/agents/quality/`, `backend/app/agents/monitoring/`, `backend/app/agents/maintenance/`, `backend/app/api/approvals.py`, `backend/app/api/chat.py`, `backend/app/api/ws.py`, `backend/app/api/agents.py`, `backend/app/api/dashboard.py`, `backend/app/api/history.py`, `backend/app/api/quality.py`, `backend/app/api/machine_ops.py`, `backend/tests/orchestrator/`, `docs/orchestrator.md`, `docs/requests/p3.md` |
| P4 | `desktop/src/pages/` **except** `factory-floor/` and `agent-map/`, `desktop/src/global/`, `desktop/src/components/`, `desktop/tests/pages/`, `docs/desktop-pages.md`, `docs/requests/p4.md` |
| P5 | `desktop/src/pages/factory-floor/`, `desktop/src/pages/agent-map/`, `desktop/src/figures/`, `desktop/tests/figures/`, `docs/iso-figures.md`, `docs/requests/p5.md` |

Extra rules:
- Each person also owns `docs/plans/<your-id>.md` and `docs/requests/<your-id>.md`.
- **No new dependencies.** P1 puts every dependency in `requirements.txt` and `package.json` up front. Use `pip install -r` and `npm ci` only. Never commit a changed lockfile unless you are P1. If you truly need a new package, write it in your requests file.
- Do not create `__init__.py`, config, or test helper files outside your paths. P1 already created the shared ones.
- Before you finish, run `scripts/check-ownership.sh <your-id>`. It fails if your branch changed any file outside your paths. It must pass.

## C. Auto-discovery (so nobody edits a shared "registry" file)

- **Backend REST:** `backend/app/main.py` (P1) imports every module in `backend/app/api/` and includes its `router` (`APIRouter`) automatically. Just create your file with a `router` variable.
- **Backend services:** each agent package has a `__main__.py`. `docker-compose.yml` (P1) already defines every service:
  `orchestrator → python -m app.orchestrator`, `agent-order → python -m app.agents.order`, `agent-material → python -m app.agents.material`, `agent-planning → python -m app.agents.planning`, `agent-quality → python -m app.agents.quality`, `agent-monitoring → python -m app.agents.monitoring`, `agent-maintenance → python -m app.agents.maintenance`, `simulator → python -m app.simulator`.
  Before the merge, start only the services that exist on your branch: `docker compose up postgres rabbitmq greenmail api <your services>`.
- **Desktop pages:** `desktop/src/App.tsx` (P1) loads `import.meta.glob('./pages/*/route.tsx', { eager: true })`. Each `route.tsx` default-exports:
  `{ path: string, label: string, icon: string, roles: Role[], order: number, element: ReactNode }`. The sidebar is built from these.
- **Desktop global pieces:** `desktop/src/shell/Layout.tsx` (P1) renders every `desktop/src/global/*/index.tsx` default export once (chat panel, toaster, notification bell).
- **Desktop mocks:** `desktop/src/api/client.ts` (P1) loads `import.meta.glob('../**/mocks.ts')`. When `VITE_USE_MOCKS=true`, a request is answered by a registered mock. In your `mocks.ts` call `registerMock(method, pathPattern, handler)`.

## D. Shared backend pieces (built by P1, used by everyone)

- `app.core.config.settings` (Pydantic `BaseSettings` from `.env`)
- `app.core.db.get_session()` (async SQLAlchemy session), `app.core.db.session_scope()` for workers
- `app.core.security`: `current_user`, `require_roles("manager", ...)`
- `app.core.audit.write_audit(session, actor, action, entity, entity_id, before, after)`
- `app.models.*`: every table in section F
- `app.schemas.envelope.Envelope` (section G) and `app.schemas.contracts`: one Pydantic model per action payload/result in section H
- `app.messaging`: `publish_task(to_agent, action, order_id, payload, correlation_id)`, `publish_result(task, status, payload, notes)`, `publish_event(routing_key, data)`, `run_consumer(queue_name, handler)`. It does schema checks, idempotency (table `processed_messages`), retries, dead-letter, writes every message to `agent_messages`, and publishes a copy to `event.agent_message`.
- `app.llm.client`: `call_claude(purpose, model, messages, tools=None, response_schema=None)` with token and cost logging and the daily cost limit. `purpose` is one of `orchestrator`, `extraction`, `explain`.

## E. Tech stack (fixed)

Backend: Python 3.12, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2 async + asyncpg, Alembic, aio-pika, anthropic SDK, Google OR-Tools (CP-SAT), python-docx, openpyxl, imaplib (stdlib), smtplib (stdlib, simulator only), PyJWT, passlib[bcrypt], reportlab (simulator PO PDFs), pytest, pytest-asyncio, httpx, ruff.
Infra: PostgreSQL 16, RabbitMQ 3 (management), **GreenMail** (dev mail server with SMTP + IMAP; Mailpit has no IMAP), Docker Compose.
Desktop: Electron, Vite, electron-builder, React 18, TypeScript, React Router, TanStack Query, Zustand, Recharts, Anatomy kit (copied to `desktop/src/iso/`), Vitest, React Testing Library, Playwright.

## F. Database tables (P1 creates all models and one initial migration)

UUID keys, `created_at`, `updated_at` everywhere.
`users`(name, email, password_hash, role: manager|sales|planner|store|qc|admin, backup_approver_id) · `customers` · `parts`(part_number, revision, customer_id) · `bom_lines`(part_id, material_id, quantity_per_part, scrap_rate) · `routings`(part_id, step_number, machine_type, setup_minutes, cycle_seconds_per_part) · `quotations`(customer_id, part_id, quantity, unit_price, quoted_due_date, status) · `materials`(code, name, unit, min_stock, last_counted_at) · `suppliers`, `supplier_items`(supplier_id, material_id, lead_time_days) · `stock_movements`(material_id, quantity ±, type: receive|issue|scrap|return|adjust, reference, user_id) · `stock_holds`(material_id, order_id, quantity, type: temporary|firm, expires_at) · `purchase_requests` · `machines`(code, name, machine_type, status: running|idle|setup|down|maintenance, floor_x, floor_y) · `shifts`, `holidays` · `orders`(customer_id, po_number, po_revision, status, due_date, promised_date, source_document_id, quotation_id) · `order_lines` · `source_documents` · `extracted_fields`(order_id, field_name, value, confidence, source_page, source_text, corrected_value, corrected_by) · `schedule_slots`(order_id, machine_id, routing_step, start_at, end_at, status: tentative|locked|done) · `plan_options`(order_id, option_type: as_requested|delay|split|overtime|move_other_order, finish_date, overtime_hours, extra_cost, margin, impacted_orders JSON, explanation, is_recommended) · `approvals`(order_id, approval_type: order|replan, approver_id, decision: approve|reject|choose_option|question, chosen_option_id, reject_reason: replan|counter_offer|decline, comment, decided_at) · `workflow_runs`(order_id, state, attempts JSON, last_error, next_timeout_at) · `agent_messages`(message_id, correlation_id, order_id, from_agent, to_agent, type, action, status, payload JSON, notes, latency_ms, tokens_in, tokens_out, cost_usd) · `processed_messages`(message_id, consumer) · `customer_messages`(order_id, draft_text, status: draft|sent_by_sales) · `qc_plans`, `qc_records` · `machine_events` · `maintenance_events` · `notifications`(user_id, kind, title, body, link, read_at) · `app_settings`(key, value) · `audit_log`.

Order workflow states (`orders.status` and `workflow_runs.state`):
`RECEIVED, EXTRACTED, NEEDS_FIELD_CHECK, VERIFIED, MATERIAL_CHECKED, PLANNED, WAITING_APPROVAL, RECHECKING, CONFIRMED, REPLY_DRAFTED, CUSTOMER_REPLIED, IN_PRODUCTION, COMPLETED, REJECTED, DECLINED, REPLAN_NEEDED, FAILED`.

## G. Message envelope (every RabbitMQ message)

```json
{ "message_id": "uuid", "correlation_id": "uuid", "order_id": "uuid|null",
  "type": "task|result|event", "from_agent": "orchestrator", "to_agent": "material",
  "action": "check_and_hold", "payload": {}, "status": "ok|partial|failed|null",
  "notes": "LLM free text, never used as data", "attempt": 1,
  "reply_by": "ISO-8601", "sent_at": "ISO-8601" }
```
Exchange `factory` (topic). Task queues: `agent.order`, `agent.material`, `agent.planning`, `agent.quality`, `agent.monitoring`, `agent.maintenance`. Results: `orchestrator.results`. Events: routing keys `event.*`. Each queue has a dead-letter queue `<name>.dlq`.

## H. Agent actions (task → result). Orchestrator (P3) sends; agents (P2, P3) answer.

| Agent | Action | Payload | Result payload |
|---|---|---|---|
| order (P2) | `extract_document` | `{document_id}` | `{order_id, fields_needing_check: [field_name], quotation_mismatches: [{field, po_value, quote_value}]}` |
| order (P2) | `draft_customer_reply` | `{order_id, plan_option_id}` | `{customer_message_id}` |
| order (P2) | `close_order` | `{order_id}` | `{}` |
| material (P2) | `check_and_hold` | `{order_id}` | `{material_ready_date, shortages: [{material_id, short_qty, arrives}], hold_ids, hold_expires_at, data_warnings: [str]}` |
| material (P2) | `recheck_holds` | `{order_id}` | `{valid: bool, changes: [str]}` |
| material (P2) | `confirm_holds` / `release_holds` | `{order_id}` | `{}` |
| material (P2) | `create_purchase_requests` | `{order_id}` | `{purchase_request_ids}` |
| planning (P2) | `plan_order` | `{order_id, material_ready_date}` | `{plan_option_ids, recommended_option_id, can_meet_due_date: bool}` |
| planning (P2) | `recheck_plan` | `{order_id, plan_option_id}` | `{valid: bool, changes: [str]}` |
| planning (P2) | `lock_plan` / `release_plan` | `{order_id, plan_option_id?}` | `{}` |
| planning (P2) | `replan_for_machine` | `{machine_id, unavailable_from, unavailable_to}` | `{affected_order_ids, plan_option_ids_by_order}` |
| quality (P3) | `create_qc_plan` | `{order_id}` | `{qc_plan_id}` |
| quality (P3) | `verify_completion` | `{order_id}` | `{complete: bool, missing: [str]}` |

Events (published with `publish_event`):

| Routing key | Publisher | Data |
|---|---|---|
| `event.order.received` | order agent (P2) | `{order_id, document_id}` (order row already created, status RECEIVED) |
| `event.order.fields_corrected` | orders API (P2) | `{order_id}` (sales finished the field check) |
| `event.order.revised` | order agent (P2) | `{order_id, previous_order_id}` |
| `event.machine.raw` | simulator (P1) or machine_ops API (P3) | `{machine_id, kind: status|count, value, at}` |
| `event.machine.status_changed` | monitoring agent (P3) | `{machine_id, status}` |
| `event.machine.unavailable` | maintenance agent (P3) | `{machine_id, from, to, reason}` |
| `event.order.behind_schedule` | monitoring agent (P3) | `{order_id, minutes_behind}` |
| `event.order.state_changed` | orchestrator (P3) | `{order_id, from_state, to_state}` |
| `event.approval.created` | orchestrator (P3) | `{approval_id, order_id, approval_type}` |
| `event.notification` | orchestrator (P3) | `{user_ids, kind, title, body, link}` |
| `event.agent_message` | messaging lib (P1) | the full envelope + latency/tokens/cost |

## I. REST API (prefix `/api`, JSON, JWT bearer)

| Owner | Method + path | Purpose |
|---|---|---|
| P1 | `POST /auth/login`, `GET /auth/me` | login, current user |
| P1 | `GET/POST/PATCH /users`, `/customers`, `/parts`, `/parts/{id}/bom`, `/parts/{id}/routing`, `/suppliers`, `/machines`, `/shifts`, `/holidays` | master data CRUD |
| P1 | `GET/PATCH /settings` | business thresholds |
| P1 | `GET /health` | health |
| P2 | `GET /orders`, `GET /orders/{id}`, `GET /orders/{id}/document` (file), `GET /orders/{id}/fields`, `PATCH /orders/{id}/fields`, `POST /orders/{id}/fields/confirm`, `POST /orders/upload` | orders and field check |
| P2 | `GET /orders/{id}/plan-options`, `GET /orders/{id}/material-status`, `GET /orders/{id}/customer-message`, `POST /orders/{id}/customer-message/sent` | approval pack data |
| P2 | `GET /materials`, `GET /materials/{id}`, `POST /stock-movements`, `GET /stock-movements`, `GET /holds`, `GET /purchase-requests`, `POST /cycle-counts` | materials |
| P2 | `GET/POST/PATCH /quotations`, `POST /quotations/{id}/check-date` | quotations + what-if |
| P2 | `GET /schedule?from&to&machine_id`, `POST /plan/what-if` | schedule, what-if |
| P3 | `GET /approvals?status`, `GET /approvals/{id}` (full approval pack), `POST /approvals/{id}/decision` | approvals |
| P3 | `POST /chat` (`{message, order_id?}` → streamed text) | orchestrator chat |
| P3 | `GET /agents`, `GET /agents/{name}`, `GET /agents/{name}/messages`, `GET /orders/{id}/messages`, `GET /orders/{id}/timeline` | agent map + history |
| P3 | `GET /dashboard/kpis`, `GET /dashboard/charts/{name}` | dashboards |
| P3 | `GET /history` (audit log search), `GET /history/export.csv` | history |
| P3 | `GET /qc/orders/{id}`, `POST /qc/records` | quality |
| P3 | `POST /machines/{id}/status`, `POST /machines/{id}/output`, `POST /machines/{id}/breakdown`, `GET /machines/{id}/overview`, `GET /floor` (all machines with status, current order, count, utilisation today) | machine operations |
| P3 | `GET /notifications`, `POST /notifications/{id}/read` | notifications |
| P3 | `WS /ws?token=` | pushes `{type, data, at}` where type is `agent_message`, `order_state_changed`, `approval_created`, `machine_status_changed`, `notification` |

Response shapes: P1 writes them as TypeScript types in `desktop/src/api/types.ts` and Pydantic models in `backend/app/schemas/api.py` during the foundation. Both sides use those.

## J. Business rules (from the design)

- Only **one manager approval** per order, after extraction and planning.
- Low-confidence (< `EXTRACTION_CONFIDENCE_THRESHOLD`) or quotation-mismatched fields go to sales for a field check before planning. This is not an approval.
- Temporary stock holds expire after `HOLD_EXPIRY_HOURS`. After approval, re-check holds and plan; if anything changed, go to `REPLAN_NEEDED`.
- The Planning agent handles one order at a time. Stock holds use DB transactions with row locks.
- Earliest date = later of (material ready date, first fitting machine slot) + run time + `QC_BUFFER_HOURS` + `SHIPPING_BUFFER_DAYS`.
- No email is ever sent to a customer by the system. The Order agent drafts; sales sends and marks it sent.
- LLM only where reading or reasoning is needed. Numbers come from code, never from the LLM.
- Every human and agent action goes to `audit_log`.

## K. How everyone works

1. Read `docs/MASTER_PROMPT.md` (full background) and `docs/CONTRACT.md` (this contract) in the repo.
2. **Plan first:** write `docs/plans/<your-id>.md` (inside your paths; P1 owns `docs/plans/p1.md`, P2 `docs/plans/p2.md` and so on), then wait for approval from the person running you.
3. Simple code, clear names, no single-letter variables. No features outside your scope.
4. Write tests for your area. Mock other people's parts using the contract shapes.
5. Commit often to your branch. Push with `git push -u origin <your-branch>`.
6. When done: run your tests, run `scripts/check-ownership.sh <your-id>`, update your `docs/<area>.md`, list edge cases and tests in it, and tell P1 your branch is ready.
