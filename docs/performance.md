# Performance verification

The November 2026 optimization pass keeps route metadata eager for navigation and permissions, but loads each page implementation on demand with React.lazy. The existing loading skeleton covers initial suspension; React transitions retain the current page during navigation. A failed page download shows the themed error state with a reload/retry action.

The shared floor/agent camera now uses motion geometry throughout wheel gestures and camera transitions, restoring full detail after the wheel settles. The 160 ms quiet period resets on each wheel event and is cleared on unmount. Right-drag pan, orbit, keyboard controls, selection and reduced-motion preferences retain their existing behavior.

Agent summaries aggregate results, last-seen timestamps and pending tasks across the requested agents. The list performs four aggregate queries plus authentication instead of repeating queries for every agent. Orchestrator LLM usage and store-role cost hiding retain their existing meanings. No database migration or new runtime dependency is required.

## Evidence

- Main JavaScript entry: about 954 kB before and 290 kB after in equivalent mock builds (uncompressed). This is the entry chunk, not the total application size. Dashboard charts are downloaded when the dashboard opens.
- Agent-list regression: 26 database statements before and 5 after, including authentication, for eight agents. The test also checks metrics, expired/answered tasks, individual/list parity and store-role cost hiding.
- Local Chromium benchmark at 1440 × 970: wheel zoom reached 60 FPS on Factory floor and 59.5 FPS on Agent map after the change; right-drag pan was about 60 FPS on both. These are synthetic mock-scene measurements, not a guarantee on other hardware or large layouts. Orbit remains more expensive (roughly 30–43 FPS in this run); no orbit speedup is claimed.
- Verification: 119 desktop tests passed with two workers; 137 backend integration tests passed in Docker with 3 optional tests skipped; the 3 repository-ownership tests passed separately on the host. The editor, general UI and page-download failure/retry browser scripts passed. Ruff passed for changed Python files. A prior concurrent build/test run hit timeouts; the final desktop suite used `npm test -- --maxWorkers=2` after fixing a real-network dependency in the new test.
- The rebuilt local API returned HTTP 200 for floor, floor layout, agents, machines, orders and materials. Five warmed read-only requests per endpoint had local medians of approximately 30, 8, 22, 5, 8 and 9 ms respectively. These are current timings, not a before/after API latency comparison.

Fast-anything profiled the Node browser driver and found no own-function hotspot: rendering runs in Chromium rather than that Node process. Its separate Python CPU benchmark identified floor collision validation, but recording rejected the Pydantic LayoutIn input as non-plain data. No Rust port was enabled and no Rust equivalence/speedup claim is made. Profiling artifacts remain local under .fast/.

## Repeat checks

From `desktop`:

```powershell
npm test
npm run build
```

For browser performance and page-loading recovery, build with `VITE_USE_MOCKS=true`, serve `dist` with `npx vite preview --host 127.0.0.1 --port 5174 --strictPort`, then run:

```powershell
node tests/figures/camera-performance.mjs
node tests/figures/page-loading-review.mjs
$env:P5_URL = 'http://127.0.0.1:5174'
node tests/figures/review-ui.mjs
```

The editor browser script imports source modules and requires a separate mock **dev** server, as documented in [floor-editor.md](floor-editor.md).

From `backend`, `python -m tests.benchmarks.floor_validation` benchmarks only validation with synthetic valid layouts; it never opens a database. The backend integration suite requires an explicitly isolated TEST_DATABASE_URL because its fixture recreates the named database. This pass used a disposable PostgreSQL container, not application data.
