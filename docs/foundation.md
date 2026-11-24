# Foundation guide (P1)

How to use what the foundation gives you. The rules are in `CONTRACT.md`; this is the practical guide.

## Run it

```bash
cp .env.example .env                      # then change every change-me
docker compose up -d postgres rabbitmq greenmail api
docker compose --profile tools run --rm seed
curl localhost:8000/api/health
cd desktop && npm ci && npm run dev       # Electron window; or `npm run dev:web` for a browser tab
```

Demo logins (password = `ADMIN_INITIAL_PASSWORD`): `admin@factory.local`, `manager@factory.local`, `manager2@factory.local` (backup), `sales@factory.local`, `planner@factory.local`, `store@factory.local`, `qc@factory.local`.

Start only the services that exist on your branch, e.g. P2: `docker compose up -d postgres rabbitmq greenmail api agent-order agent-material agent-planning`.

## Backend

| Need | Use |
|---|---|
| Settings | `from app.core.config import settings` |
| DB session in a route | `session: AsyncSession = Depends(get_session)` (commit yourself) |
| DB session in a worker | `async with session_scope() as session:` (commits on success) |
| Logged-in user / role check | `Depends(current_user)`, `Depends(require_roles("manager"))` (admin always passes) |
| Audit | `await write_audit(session, user_or_agent_name, "action", "entity", entity_id, before, after)` |
| Send a task (orchestrator) | `await publish_task("material", "check_and_hold", order_id, {"order_id": ...}, correlation_id=run.id)` |
| Answer a task (agent) | `await publish_result(task, "ok", {...})`; on failure just raise: the consumer retries, then sends a `failed` result |
| Publish an event | `await publish_event("event.order.received", {...}, from_agent="order")` |
| Consume | `await run_consumer("agent.material", handle)`; events: `run_consumer("monitoring.events", handle, bindings=["event.machine.raw"])`; one at a time: `prefetch=1` |
| Call Claude | `await call_claude("extraction", messages, response_schema=SCHEMA, order_id=...)` (see `app/llm/client.py`) |
| PDF / image to Claude | `document_block(pdf_bytes)`, `image_block(bytes, "image/png")` |

An agent `__main__.py` looks like:

```python
import asyncio
from app.core.logging import setup_logging
from app.messaging import publish_result, run_consumer

async def handle(task):
    if task.action == "check_and_hold":
        ...
        await publish_result(task, "ok", result_model)

if __name__ == "__main__":
    setup_logging()
    asyncio.run(run_consumer("agent.material", handle))
```

## Tests

```bash
cd backend && pip install -r requirements.txt
export TEST_DATABASE_URL=postgresql+asyncpg://factory:<password>@localhost:5432/factory_test
pytest tests/<your folder>
```

Fixtures (from `tests/conftest.py`): `client`, `db_session`, `users`, `auth_headers("manager")`, `fake_broker` (autouse; `fake_broker.published_to("task.material")`), `fake_claude` (`fake_claude.add_response(text=..., tool_uses=[...])`). Tables are emptied after every test.

## Desktop

| Need | Use |
|---|---|
| Add a page | `src/pages/<name>/route.tsx` default-exporting `{ path, label, icon, roles, order, element }` |
| Add a top-bar piece | `src/global/<name>/index.tsx` default-exporting a component |
| Call the API | `apiFetch<OrderDetail>("/orders/" + id)` with TanStack Query (`useQuery`) |
| Types | `import type { OrderDetail } from "../../api/types"` |
| Live events | `useLiveEvents(["machine_status_changed"], (event) => ...)` |
| Mocks | `src/pages/<name>/mocks.ts`: `registerMock("GET", "/orders/:id", ({ params }) => ...)`; run with `VITE_USE_MOCKS=true npm run dev:web` |
| Current user | `useAuthStore((state) => state.user)`, `useAuthStore.getState().hasRole("sales")` |
| Desktop features | `desktop.notify(title, body)`, `desktop.openFile()` from `src/shell/desktop-bridge.ts` |
| Theme | CSS variables in `src/theme/tokens.css` (`--color-*`, `--status-*`, `--space-*`); `statusColor("down")` |
| Isometric kit (P5) | `src/iso/` (see its README) |

Tests: `npm test` (Vitest + Testing Library, jsdom). Put yours in your own `tests/<area>/` folder.

## Before you finish

```bash
scripts/check-ownership.sh <your-id>
```
