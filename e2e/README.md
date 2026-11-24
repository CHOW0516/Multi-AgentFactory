# End-to-end tests

Real desktop app (Electron) against the real stack. They pass only after all five branches are merged.

1. `docker compose up -d` and seed (`docker compose run --rm seed`).
2. `cd desktop && VITE_USE_MOCKS=false npm run build`
3. `E2E_PASSWORD=<ADMIN_INITIAL_PASSWORD> npm run e2e` (on a Linux server without a screen: `xvfb-run -a npm run e2e`).

Settings (environment variables): `E2E_API_BASE_URL` (default `http://localhost:8000`), `E2E_PASSWORD`
(the seed password; falls back to `ADMIN_INITIAL_PASSWORD`), `E2E_MANAGER_EMAIL`, `E2E_SALES_EMAIL`,
`E2E_SEND_PO_COMMAND` (how to send one demo PO; default runs the simulator container).

The tests use contract endpoints for setup and the `data-testid`s listed in `docs/CONTRACT.md`
("Foundation updates", item 12) for the UI.
