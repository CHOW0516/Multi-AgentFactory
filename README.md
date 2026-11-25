# Factory Commit

A multi-agent AI system for small and medium contract manufacturers. When a customer PO arrives, agents read it, check material, plan the schedule, and show the manager the impact of confirming. The manager approves **once**. A desktop app shows an isometric factory floor, a live agent map, approvals, dashboards and history.

- Background and full design: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md)
- Team contract (ownership, APIs, messages): [`docs/CONTRACT.md`](docs/CONTRACT.md)
- How to use the foundation: [`docs/foundation.md`](docs/foundation.md)

## Stack

Backend: Python 3.12, FastAPI, PostgreSQL 16, RabbitMQ, SQLAlchemy 2, Alembic, Claude (Anthropic SDK), OR-Tools.
Desktop: Electron, React 18, TypeScript, Vite, TanStack Query, Zustand, Recharts, Anatomy isometric kit.

## Quick start

```bash
cp .env.example .env            # change every change-me, add AI_API_KEY (Grafilab)
docker compose up -d postgres rabbitmq greenmail api
docker compose --profile tools run --rm seed
cd desktop && npm ci && npm run dev
```

## Layout

```
backend/   FastAPI app, agents, orchestrator, simulator, tests
desktop/   Electron + React app
docs/      contract, plans, guides
scripts/   ownership checks
e2e/       end-to-end tests (Playwright)
```

## Team branches

| Person | Branch | Area |
|---|---|---|
| P1 | `p1-foundation`, `p1-integration` | Foundation, simulator, e2e, packaging, merges |
| P2 | `p2-domain-agents` | Order, Material, Planning agents |
| P3 | `p3-orchestrator` | Orchestrator, approvals, chat, live events, shop-floor agents |
| P4 | `p4-desktop-pages` | Desktop pages |
| P5 | `p5-iso-figures` | Factory floor and Agent map |

Each person only changes files they own (`ownership.json`). Check with `scripts/check-ownership.sh <id>`.

## Operations

- Day-to-day running, backups, restore and the paper fallback: [docs/RUNBOOK.md](docs/RUNBOOK.md).
- Demo POs: `docker compose up -d simulator` (one every `SIM_PO_INTERVAL_SECONDS`), or one now with
  `docker compose run --rm simulator python -m app.simulator send-po`.
- End-to-end tests (after the merge, with the stack running and the desktop built with
  `VITE_USE_MOCKS=false`): `cd desktop && E2E_PASSWORD=<seed password> npm run e2e`.
- Installers: `cd desktop && VITE_API_BASE_URL=http://<server>:8000 npm run dist` (build Windows on Windows and macOS on a Mac).
