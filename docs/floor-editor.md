# Visual factory floor editor

Admins open **Factory floor → Edit floor**. Other roles retain the live view and cannot save layouts through the API. Settings retains the machine registry, statuses and unrelated settings; machine creation and coordinate inputs have moved to the editor.

The **Edit floor layout** action in **Settings → Machines** opens the editor directly for admins.

## Editing

- Select a palette item and click the floor, or drag it from the palette. Everything snaps to a 10-world-unit cell. Machine types come from existing machines, routing types and the six illustrated types; other types use the existing generic machine artwork.
- Drag a placed item to move it. Green previews are valid; red previews are blocked. Solid items cannot overlap or extend outside the floor. Aisles, zones, crossings, roads, road marks and low curbs occupy the ground layer and may overlap other items.
- Select an item to edit its name and inspect its immutable UUID. Machines also have editable unique codes and routing types, plus a read-only production status. **Rotate 90°** or **R** rotates the item and its footprint. **Remove** or **Delete** removes its placement.
- Removing a machine retains its production record, events, jobs and availability for planning. Find it under **Unplaced machines** to place it again. Decor never enters the machine registry, counters, alerts or dashboards.
- For walls, drag from the first cell to the last. A horizontal or vertical run is one item and one undo step. Its length is editable in the properties panel.
- Enter floor width/depth in cells and click **Resize floor**. A resize that would clip any placed item is blocked, including exterior fixtures. Remove or move those fixtures first.
- **Undo / Redo** cover additions, moves, rotations, removals, property edits and resizing. Shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. One drag or wall run creates one step; text edits commit on blur, leaving native text undo available while typing.
- For keyboard placement, selecting a palette item focuses the floor. Use arrows for the grid cursor and Enter to place. Focus a placed item and press Enter to select it; focus the floor and use arrows/Enter to move it. Right-drag pans, the wheel zooms, Alt+arrows orbit, and the camera buttons remain available.

**Save** commits the complete draft in one transaction, including machine properties, placements, decor and dimensions. It retains history until the edit session ends. Undoing after Save creates an unsaved change. **Cancel** restores the latest successful save, clears history and exits. Exiting edit mode, navigating, logging out and closing/reloading a tab warn while unsaved changes exist. Background refreshes and reconnects do not replace the draft or history. An unsuccessful Save retains the draft; a revision conflict requires reviewing the newer saved layout before retrying from a fresh session.

## Catalog and artwork

| Category | Placeable items |
| --- | --- |
| Machines | CNC lathe, CNC mill, laser cutter, press brake, QC station, packing station, existing custom/routing types |
| Structure | Wall runs, loading wing with dock doors and roof equipment, glazed office, dispatch bollards, curbs |
| Furniture | Storage racks with cartons, loaded pallets, work tables, chairs, computers |
| Markings | Aisles, pedestrian crossings, bay/zone outlines, road/apron surfaces, road markings |

The existing Anatomy geometry and theme materials supply the artwork. The wall run is new. Standalone tables, chairs and computers were extracted/adapted from the existing office and bench geometry. Racks, pallets, the office, loading wing and dispatch fixtures reuse the current scene. Doors, glazing, roof fittings and cartons remain part of their parent assemblies. The deck and expansion joints are generated from floor dimensions; machine bay outlines follow the current rotated footprint.

Decor has no live state. The office computer is cosmetic; live approval counts remain in the floor's existing metrics. The delivery cart remains a transient live animation, outside the saved decor catalog.

## Migration, rollout and rollback

From `backend`, with the normal application configuration:

```powershell
python -m alembic upgrade head
```

Revision `0003`, following the existing `0002` simulator-lines migration, adds `floor_layout`, `floor_placements` and nullable `machines.original_floor_x/original_floor_y`. It copies the original coordinates before snapping legacy positions to the nearest 10 units (half-cells round toward positive infinity). Machine UUIDs, codes, production records and references remain intact. Alembic's transactional upgrade and revision tracking make retries safe.

Until the first Save, the API derives cell placements and the initial decor from existing data without writing during GET requests. Initial bounds include interior and exterior fixtures and expand for existing machines, including negative coordinates. The first Save persists this layout; later empty/deleted decor stays deleted. Legacy collisions are reported in the editor and must be corrected before Save; migration never deletes or silently separates machines.

Apply the migration before running the updated backend. Update the backend and desktop together for editing: the old machine POST/PATCH write routes now return an explanatory 409, directing clients to Edit Floor. Machine status/output/breakdown endpoints are unchanged. Legacy `floor_x/floor_y` outputs remain world coordinates and are synchronized on successful saves; `GET /floor` also supplies rotation and the typed layout, and includes only placed machines. `GET /machines` remains the complete production registry.

The save endpoint uses a PostgreSQL transaction, a shared/exclusive advisory lock for consistent layout reads/writes, a revision check, server-side placement validation and an audit record. Concurrent saves cannot silently overwrite each other. Machine identities and live status are separate from placement; saving never writes stale live status back to machines.

Application rollback can leave the additive schema in place. An older application will display its original layout behavior, including all registered machines. Schema downgrade restores archived coordinates only when no layout has been saved; it deliberately refuses to drop saved layout data. Export/reconcile saved layouts before any separately planned destructive schema rollback. No legacy columns are removed by this feature.

## Automated checks

Desktop:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Browser acceptance checks, against a separate mock preview:

```powershell
# Terminal 1, in desktop
$env:VITE_USE_MOCKS = 'true'
npm run dev:web -- --host 127.0.0.1 --port 5174 --strictPort
# Terminal 2, in desktop
node tests/figures/floor-editor-review.mjs
```

The browser script covers admin/viewer gating, valid/invalid previews, adding machines, dragging from the palette, moving, rotating, wall runs, clipping, property edits, undo/redo, history across Save, layout-only removal, Cancel, page-navigation warnings and the browser's native close warning. It captures light/dark screenshots under `desktop/dist/floor-editor-qa`. Mock state is held in memory; use the real backend for persistence across browser reloads.

Backend checks use a dedicated disposable PostgreSQL database: the repository's test fixture recreates the database named by `TEST_DATABASE_URL`. Keep it separate from application data. With an isolated PostgreSQL instance on port 55432 and the existing backend requirements installed:

```powershell
cd backend
$env:TEST_DATABASE_URL = 'postgresql+asyncpg://factory:factory@127.0.0.1:55432/factory_floor_test'
python -m pytest tests/foundation/test_floor_layout.py tests/foundation/test_migrations_and_seed.py tests/foundation/test_auth_and_master_data.py tests/orchestrator/test_operations.py -q
```

The new server tests include legacy coordinate retention and upgrade retries, permission denial for every non-admin role, geometry/property validation, simultaneous first saves, live-reader compatibility, retained machine records and injected failure after database flush. The latter verifies that dimensions, decor, properties, positions and revision all remain at their prior saved values.

## Manual acceptance checks

1. **Roles and Settings:** log in as admin; check that Edit Floor exists and Settings no longer offers coordinate inputs or Add machine. Log in as manager/planner/store/QC/sales; editing must be unavailable and layout PUT must return 403.
2. **Placement and rotation:** add a machine and furniture, attempt an overlap, then place them in clear space. Move a non-square item near an edge and rotate it: a rotation that crosses the edge must be blocked without changing the item. Rotate a clear item four times and verify its original footprint/orientation returns.
3. **Walls and resize:** draw both horizontal and vertical runs. Undo each with one action. Attempt to shrink across a machine or decor item; verify the resize is blocked. Enlarge, undo and redo the resize.
4. **Mixed history:** add → move → rotate → edit name/code/type → remove → resize. Undo to the original layout, then redo through the sequence. Save, undo once and verify the change is unsaved; redo to the saved state. Check toolbar disabled states and all three undo/redo shortcuts.
5. **Cancel and leaving:** change a saved layout, Cancel, and re-enter: the saved layout must return with empty history. Repeat with Exit edit mode, another page, logout, browser reload/close and Electron close; dismiss the warning to keep the draft, or confirm to leave. Test a network reconnect/background refresh while dirty; draft and history must remain.
6. **Migration:** upgrade a copy of an existing database. Compare UUIDs and archived original coordinates, including off-grid and negative positions. Check the snapped machines in the live view and editor. Re-run upgrade; values must not change again. Resolve any reported old collisions before Save.
7. **Persistence and failure:** Save and reload using the real backend; dimensions, items, properties and rotations must persist. Make a draft, take the browser offline before Save, and verify the error leaves the draft editable. Reconnect and retry. Check the last saved layout from another session. Use the injected-failure server test to verify rollback after writes have started.
8. **Removal and concurrent admins:** remove a machine and Save. It must leave the floor while retaining its registry entry, history and production data, and appear as unplaced for re-addition. Open two edit sessions at the same revision: Save one, then Save the other. The second must report a conflict and keep its draft. Adding decor must never increase machine counts.
