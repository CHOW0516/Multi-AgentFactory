# Isometric figures

## Factory floor

The hall places each bay at its machine’s `floor_x` and `floor_y`. The cutaway windows show the lathe chuck, mill spindle, press brake ram and laser head. The beacons reflect machine status, the panel displays the current order and part count, and the office monitor displays pending approvals.

`GET /floor` supplies the floor snapshot. Machine-status events update beacons immediately and refresh the floor and affected overview. Approval and order events refresh the summary. The cart takes the marked aisle from the store after a successful Material result explicitly identifies an issue and a destination. An ambiguous or missing assignment leaves the cart parked.

Hover or focus a machine for its readout. Click or press Enter to open its jobs, utilisation, event list and maintenance history. Manager, planner and admin accounts see the status and breakdown forms. Those forms submit to the machine operations API.

[Factory floor screenshot](../desktop/tests/figures/screenshots/factory-floor.png)

## Agent map

The console is the Orchestrator. A peripheral workstation represents each agent’s job. The RabbitMQ ring and its feeder rails carry parcels, and the PostgreSQL vault connects to the stations through low-profile conduits. The Simulator station appears in demo mode.

A task flows out to its destination. A result flows back from the agent that performed the work. Event parcels follow the station address when the envelope contains one. A failed result marks its station, and the parcel shakes at the station before returning to the hub. Each link spaces parcels and gives traffic time to clear before reversing the flow. Duplicate message IDs produce one parcel.

Station drawers use the agent summary and message endpoints. The rail drawer filters the same messages to the selected link. Replay uses the order’s dated messages, preserves their chronological order and reserves shared rails before sending a parcel. Play at 1× or 4×, pause, or use the time slider to inspect a moment.

Messages per minute and failures observed today are based on the events received while the map is mounted. Server summaries supply the station’s queue and in-progress counters. The current-task list matches tasks and results within the recent messages.

[Agent map screenshot](../desktop/tests/figures/screenshots/agent-map.png)

## Run and verify

In `desktop`, install the locked dependencies with `npm ci`. To run the P5 mock demo in PowerShell:

```powershell
$env:VITE_USE_MOCKS = 'true'
npm.cmd run dev:web
```

On the P1 foundation, log in with `manager@factory.local` and password `demo`. The mock generator emits agent messages and changes a machine’s status. Set `VITE_P5_MOCK_MESSAGES_PER_SECOND=5` before starting or building Vite to exercise the map at five messages per second.

Run `npm test` for the desktop suite. P5 covers status changes, correct machine IDs, cart occlusion, deduplicated parcels, failed results, chronological replay, hidden tabs and reduced motion. Normal animation runs through SVG attributes. The browser’s visibility and intersection observers gate the frame loop without driving React renders on every frame.

For browser captures, build with the mock environment and run `node tests/figures/capture.mjs`. Set `CHROME_PATH` if using an installed Chrome. The script writes desktop, phone and 4× machine and station captures to `desktop/dist/p5-qa`, with WebGL disabled. The drawings use planar solids and surface markings.

Anatomy’s line checker found zero floating endpoints in both themes across 18 floor endpoints and 12 map endpoints. The five-message-per-second Chrome runs averaged 72 fps in the dedicated probe and 17 fps alongside the capture run. Confirming a steady 60 fps on the target laptop remains open.

The P5 branch starts from P1’s foundation. The browser checks use mocks, with the outstanding backend integration details recorded in [P5 integration requests](requests/p5.md).
