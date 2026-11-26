# Graph Report - Multi-AgentFactory  (2026-11-26)

## Corpus Check
- 325 files · ~188,537 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2908 nodes · 8670 edges · 158 communities (117 shown, 30 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 301 edges (avg confidence: 0.89)
- Token cost: unavailable — the host agent does not expose actual usage; this run was not measured as zero.

## Graph Freshness
- Built from commit: `3afc2a82`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Desktop API Contracts
- Simulator Purchase Order Generation
- Desktop Order And Settings Workflows
- Desktop Order And Settings Workflows
- Shared Database Models
- AI Request And Usage
- Isometric Geometry Primitives
- Purchase Order Intake Events
- Database Sessions And Authentication
- API Schemas And Authentication
- Lathe Geometry Construction
- Planning Calendar Solver
- Master Data CRUD
- Factory Camera Navigation
- Desktop Route And Shell
- Demo Order Scenarios
- Isometric Projection Types
- Desktop API Contracts
- Orchestrator Outbox Recovery
- Order API Queries
- Purchase Order Field Extraction
- Visual Floor Editor
- Floor Layout API And Tests
- Live Demo Events
- Desktop Live API Transport
- Planning Calendar Solver
- Schedule Calendar UI
- Material Movement Forms
- Dialogs And Desktop Bridge
- Domain Message Contracts
- Renderer TypeScript Configuration
- Shared Repository Architecture Contracts
- Material Reservation Services
- Desktop Live API Transport
- Material Reservation Services
- Validated Message Publishing
- Floor Layout API And Tests
- Factory And Agent Artwork
- Production Line Simulation Engine
- Purchase Order Intake Events
- Orchestrator Outbox Recovery
- Agent Map Activity
- Electron End To End
- Machine Operations And Audit
- Material Reservation Services
- Production Line Design Model
- Production Line API
- Tube Geometry Construction
- Factory Camera Navigation
- Simulation Settings And Results
- Dashboard Metrics API
- RabbitMQ Message Delivery
- Factory Docker Services
- Live Factory Floor
- Machine Operations And Chat
- In Memory Message Broker
- Backend Pinned Dependencies
- Isometric Geometry Types
- Isometric Projection Helpers
- React Isometric Drawing
- Orchestrator Outbox Recovery
- Floor Layout API And Tests
- Customer Reply And Chat
- Quality Inspection Services
- AI Request And Usage
- Desktop Development Dependencies
- Supplier Quotation API
- Planning Schedule Verification
- Time Picker Controls
- Simulation Editing And Validation
- Read Only Planning API
- Theme And Figure Components
- Floor Editor Design Contracts
- Backend Application Startup
- Runtime Configuration And Fixtures
- Desktop Runtime Dependencies
- Dashboard And Date Controls
- Accessible Tooltip Controls
- Material Reservation Services
- Electron TypeScript Configuration
- Simulator Purchase Order Generation
- RabbitMQ Message Delivery
- Ownership Checker Tests
- Lathe Solid Profiles
- Production Line Canvas
- Orchestrator Operational Contracts
- Floor Editor Browser Verification
- Isometric Projection Types
- Isometric React Motion Hooks
- Desktop Build Commands
- WebGL Scene Rendering
- Shared WebGL Rendering
- Ownership Command Tooling
- Desktop Interaction Design Contracts
- Desktop Package Identity
- Visual Browser Capture Tests
- Live Factory Figure Contracts
- Machine Data Sources
- Electron Main Process
- Production Line API Mocks
- Agent Map And Infrastructure
- Domain Agent Design Contracts
- Desktop Theme Tokens
- Camera Performance Verification
- Responsive UI Verification
- End To End Launcher
- Factory Scenario Specification
- Runtime Configuration And Fixtures
- Desktop Installer Configuration
- Isometric Kit Architecture
- UI Control Browser Verification
- Word Purchase Order Fixture
- Database Backup Script
- Electron Development Launcher
- Desktop HTML Bootstrap
- Agent Map Visual Reference
- Factory Floor Visual Reference
- Desktop Workflow Implementation Plan
- Isometric Figure Implementation Plan
- Orchestrator Integration Requests
- Desktop Integration Requests
- Figure Integration Requests
- Standard Purchase Order Fixture
- Landscape Purchase Order Fixture
- Two Column Order Fixture
- Compact Purchase Order Fixture
- Commercial Purchase Order Fixture
- Supplier Purchase Order Fixture
- Multipage Purchase Order Fixture
- Scanned Purchase Order Fixture
- Orchestrator Test Package
- DOM Simulation Dependency
- DOM Testing Dependency
- User Event Testing Dependency
- Node Type Dependency
- TypeScript Compiler Dependency
- Vite Build Dependency
- Foundation Implementation Plan
- Domain Agent Implementation Plan
- Orchestrator Implementation Plan
- Domain Integration Requests
- Real Stack Test Contracts
- Spreadsheet Purchase Order Fixture
- Overlap Check Script
- Ownership Check Script
- Database Restore Script
- Backend Package Identity

## God Nodes (most connected - your core abstractions)
1. `User` - 101 edges
2. `write_audit()` - 84 edges
3. `apiFetch()` - 64 edges
4. `session_scope()` - 59 edges
5. `TableBase` - 53 edges
6. `Order` - 53 edges
7. `ApiModel` - 49 edges
8. `auth_headers()` - 41 edges
9. `seed()` - 40 edges
10. `Machine` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Floor-layout Alembic migration 0003` --references--> `alembic`  [EXTRACTED]
  docs/floor-editor.md → backend/requirements.txt
- `Isometric agent map` --references--> `PostgreSQL`  [EXTRACTED]
  docs/iso-figures.md → docker-compose.yml
- `Isometric agent map` --references--> `RabbitMQ`  [EXTRACTED]
  docs/iso-figures.md → docker-compose.yml
- `handle()` --uses--> `Envelope`  [INFERRED]
  backend/app/agents/material/__main__.py → backend/app/schemas/envelope.py
- `latest_check()` --uses--> `CheckAndHoldResult`  [INFERRED]
  backend/app/agents/material/service.py → backend/app/schemas/contracts.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared backend runtime and persistence** — docker_compose_backend_template, docker_compose_postgres, docker_compose_rabbitmq, docker_compose_documents_volume [EXTRACTED 1.00]
- **Consistent editable floor session** — docs_floor_editor_draft_lifecycle, docs_floor_editor_undo_redo_history, docs_floor_editor_transactional_layout_save, docs_floor_editor_machine_identity_and_placement [EXTRACTED 1.00]

## Communities (158 total, 30 thin omitted)

### Community 0 - "Desktop API Contracts"
Cohesion: 0.05
Nodes (55): registerMock(), CycleCountIn, FieldCorrection, HolidayOut, MaterialStatusOut, QcRecordIn, SettingsOut, ShiftOut (+47 more)

### Community 1 - "Simulator Purchase Order Generation"
Cohesion: 0.06
Nodes (66): main(), Simulator commands. python -m app.simulator seed [--reset] [--scenarios] create…, One event loop for both steps: the database engine is tied to the loop that…, seed_command(), _classic_table(), _compact(), demo_extraction(), DemoPurchaseOrder (+58 more)

### Community 2 - "Desktop Order And Settings Workflows"
Cohesion: 0.06
Nodes (57): apiFetch(), AuditEntryOut, CustomerOut, OrderState, PartOut, itemsOf(), Column, DataTable() (+49 more)

### Community 3 - "Desktop Order And Settings Workflows"
Cohesion: 0.06
Nodes (52): ApprovalPack, ApprovalSummary, ChartOut, CustomerMessageOut, ExtractedFieldOut, KpiTile, PlanOptionOut, TimelineEntry (+44 more)

### Community 4 - "Shared Database Models"
Cohesion: 0.09
Nodes (54): get_settings(), Base, Declarative base with the columns every table shares., Abstract base: UUID primary key plus created/updated timestamps (UTC)., TableBase, BomLine, Material, Part (+46 more)

### Community 5 - "AI Request And Usage"
Cohesion: 0.06
Nodes (55): Agent, Production refuses to start with the example secrets; demo mode only warns., Settings, For workers: commit on success, roll back on error., session_scope(), AiResult, call_ai(), check_daily_limit() (+47 more)

### Community 6 - "Isometric Geometry Primitives"
Cohesion: 0.06
Nodes (55): attrs(), axesAt(), axisVector(), AZIMUTH, cameraOf(), circleRing(), convexHull(), cylinder() (+47 more)

### Community 7 - "Purchase Order Intake Events"
Cohesion: 0.06
Nodes (49): Material reservation and purchasing agent., pdf_text(), The PDF's own text layer, keeping the column layout. Empty for scans or…, Purchase order intake, field extraction, and customer drafts., Attachment, Path, store_documents(), write_attachment() (+41 more)

### Community 8 - "Database Sessions And Authentication"
Cohesion: 0.06
Nodes (53): async_sessionmaker, AsyncEngine, health(), login(), me(), AsyncSession, get, post (+45 more)

### Community 9 - "API Schemas And Authentication"
Cohesion: 0.07
Nodes (56): agent(), agent_catalog(), agent_messages(), agents(), message_page(), messages_for(), order_messages(), get (+48 more)

### Community 10 - "Lathe Geometry Construction"
Cohesion: 0.10
Nodes (55): add3(), angleToward(), arcPoints(), bandOf(), BANDS, chains(), circleOf(), cross3() (+47 more)

### Community 11 - "Planning Calendar Solver"
Cohesion: 0.08
Nodes (39): calendar(), cut(), merge(), date, datetime, time, Convert local shifts and machine exclusions to UTC working intervals., Return regular and out-of-shift intervals with holidays removed from both. (+31 more)

### Community 12 - "Master Data CRUD"
Cohesion: 0.12
Nodes (56): changed_values(), commit_or_conflict(), create_customer(), create_holiday(), create_machine(), create_part(), create_row(), create_shift() (+48 more)

### Community 13 - "Factory Camera Navigation"
Cohesion: 0.08
Nodes (35): CompactList(), MapAgent, Station, CameraControls(), activateOnKey(), kindFor(), compareDepth(), useFigureFrames() (+27 more)

### Community 14 - "Desktop Route And Shell"
Cohesion: 0.08
Nodes (32): queryClient, Role, TokenResponse, UserOut, App(), router, route, route (+24 more)

### Community 15 - "Demo Order Scenarios"
Cohesion: 0.10
Nodes (43): ExtractionModel, FieldValue, PurchaseLine, BaseModel, Order, add_scenarios(), _approvals(), _approve_and_reply() (+35 more)

### Community 16 - "Isometric Projection Types"
Cohesion: 0.06
Nodes (44): Camera, ExtrudeOptions, Faded, FadeLineStyle, FigureOptions, FitOptions, LineStyle, PageOptions (+36 more)

### Community 17 - "Desktop API Contracts"
Cohesion: 0.06
Nodes (41): disconnectLiveEvents(), useLiveEvents(), AgentMessageEventData, AgentMessageOut, AgentSummary, BomLineOut, ChartSeries, ChatRequest (+33 more)

### Community 18 - "Orchestrator Outbox Recovery"
Cohesion: 0.14
Nodes (41): WorkflowRun, AsyncSession, datetime, Free everything an order owns when it reaches a closed state. Runs inside the…, release_order_resources(), advance(), apply_options(), enqueue() (+33 more)

### Community 19 - "Order API Queries"
Cohesion: 0.13
Nodes (42): cancel_order(), CancelIn, confirm_fields(), customer_answer(), CustomerAnswerIn, download_document(), field_rows(), get_customer_message() (+34 more)

### Community 20 - "Purchase Order Field Extraction"
Cohesion: 0.11
Nodes (40): cached_extraction(), check_against_document(), compact(), demo_data_path(), earlier_extraction(), extract_document(), field_rows(), find_previous() (+32 more)

### Community 21 - "Visual Floor Editor"
Cohesion: 0.12
Nodes (34): FloorCatalogItem, FloorDocument, FloorLayout, GridPlacement, LayoutDecor, LayoutMachine, Action, cellSize (+26 more)

### Community 22 - "Floor Layout API And Tests"
Cohesion: 0.14
Nodes (33): get_layout(), get, put, One atomic, revision-checked write boundary for the complete floor draft., save_layout(), initial_decor(), machine_size(), Grid ownership, initial scene and placement invariants shared by floor APIs. (+25 more)

### Community 23 - "Live Demo Events"
Cohesion: 0.11
Nodes (29): AgentName, JobRef, actions, active, bays, broadcastDemoMessage(), changeDemoMachine(), clock() (+21 more)

### Community 24 - "Desktop Live API Transport"
Cohesion: 0.11
Nodes (25): LiveEvent, NotificationOut, ChatPanelState, useChatPanel, Block, ChatMarkdown(), MACHINE_STATUSES, parseBlocks() (+17 more)

### Community 25 - "Planning Calendar Solver"
Cohesion: 0.16
Nodes (33): overlaps(), cached_task(), clear_proposals(), explanation_parts(), explanation_text(), load_scenario(), lock_plan(), maintenance_windows() (+25 more)

### Community 26 - "Schedule Calendar UI"
Cohesion: 0.13
Nodes (26): MachineOut, MaintenanceWindowOut, ScheduleOut, ScheduleSlotOut, addDays(), Booking, bookingLabels, calendarDayFormatter() (+18 more)

### Community 27 - "Material Movement Forms"
Cohesion: 0.15
Nodes (24): MaterialOut, MovementType, PurchaseRequestOut, StockHoldOut, formatMoney(), Money(), roleAllows(), useCanSeePrices() (+16 more)

### Community 28 - "Dialogs And Desktop Bridge"
Cohesion: 0.08
Nodes (20): ApprovalDecisionIn, ConfirmDialog(), Dialog(), Drawer(), useEscapeAndFocus(), REASONS, RejectDialog(), RejectReason (+12 more)

### Community 29 - "Domain Message Contracts"
Cohesion: 0.14
Nodes (27): Factory capacity planning and schedule reservation., handle(), ApprovalCreated, CheckAndHoldResult, Contract, CreatePurchaseRequestsResult, CreateQcPlanResult, Empty (+19 more)

### Community 30 - "Renderer TypeScript Configuration"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, checkJs, esModuleInterop, isolatedModules, jsx, lib, module (+21 more)

### Community 31 - "Shared Repository Architecture Contracts"
Cohesion: 0.07
Nodes (29): Auto-discovered desktop routes, Auto-discovered global panels, One approval commitment workflow, Role-based business access, Shared repository contract, Shared REST and event contracts, Temporary inventory holds, Validated idempotent messaging (+21 more)

### Community 32 - "Material Reservation Services"
Cohesion: 0.16
Nodes (27): add_movement(), consume_holds(), cycle_count(), get_material(), list_holds(), list_materials(), lock_material(), material_rows() (+19 more)

### Community 33 - "Desktop Live API Transport"
Cohesion: 0.11
Nodes (23): answerFromMock(), __answerFromMockForTests, API_BASE_URL, ApiError, ApiFetchOptions, connectSocket(), dispatchLiveEvent(), emitMockEvent() (+15 more)

### Community 34 - "Material Reservation Services"
Cohesion: 0.24
Nodes (24): active_holds(), balances(), confirm_holds(), create_purchase_requests(), expire_holds(), Forecast, latest_check(), load_materials() (+16 more)

### Community 35 - "Validated Message Publishing"
Cohesion: 0.15
Nodes (26): UsageTotals, _already_processed(), ContractError, is_transient(), _json_ready(), _mark_processed(), publish_event(), publish_result() (+18 more)

### Community 36 - "Floor Layout API And Tests"
Cohesion: 0.10
Nodes (21): CustomerMessage, auth_headers(), test_material_and_quotation_permissions(), test_order_permissions_and_upload(), test_upload_recovers_a_pending_event(), test_master_data_roles_and_audit(), test_only_admin_creates_users(), test_part_routing_and_bom() (+13 more)

### Community 37 - "Factory And Agent Artwork"
Cohesion: 0.21
Nodes (24): createMapArt(), bin(), desk(), ducts(), screen(), segment(), spurArt(), floorArt() (+16 more)

### Community 38 - "Production Line Simulation Engine"
Cohesion: 0.13
Nodes (21): addWorkingTime(), BlockKind, canLink(), EventQueue, fillPeriods(), hasLoop(), JobResult, LineLink (+13 more)

### Community 39 - "Purchase Order Intake Events"
Cohesion: 0.14
Nodes (19): flush_events(), AsyncSession, UUID, Persist order events with the originating mutation and deliver after commit., stage_event(), address_of(), EmailMetadata, known_sender() (+11 more)

### Community 40 - "Orchestrator Outbox Recovery"
Cohesion: 0.30
Nodes (24): PlanOption, handle(), tick(), test_qc_blocks_order_completion(), answer(), decision(), event(), extraction() (+16 more)

### Community 41 - "Agent Map Activity"
Cohesion: 0.16
Nodes (22): Inspector(), stations, formatDateTime(), itemsOf(), percent(), AgentDrawer(), MessageContent(), AgentMap() (+14 more)

### Community 42 - "Electron End To End"
Cohesion: 0.20
Nodes (20): api(), API_BASE_URL, apiToken(), ApprovalSummary, bringOrderToApproval(), launchDesktop(), logIn(), logInAsManager() (+12 more)

### Community 43 - "Machine Operations And Audit"
Cohesion: 0.19
Nodes (17): Publish a machine availability change once per maintenance record and window., scan(), close_breakdowns(), handle(), minutes_behind(), datetime, Machine event ingestion and production progress calculations., End every breakdown still open at recovery time, so planning can use the… (+9 more)

### Community 44 - "Material Reservation Services"
Cohesion: 0.18
Nodes (20): expire_periodically(), handle(), main(), check_and_hold(), OrderRef, datetime, The envelope every RabbitMQ message uses (contract section G)., utc_now() (+12 more)

### Community 45 - "Production Line Design Model"
Cohesion: 0.18
Nodes (21): LineBlock, machineTypeInfo, normalizeMachineType(), Gesture, TYPE_TAGS, BLOCK_HEIGHT, BLOCK_WIDTH, blockAt() (+13 more)

### Community 46 - "Production Line API"
Cohesion: 0.19
Nodes (21): create_line(), delete_line(), design_json(), get_line(), list_lines(), AsyncSession, BaseModel, get (+13 more)

### Community 47 - "Tube Geometry Construction"
Cohesion: 0.16
Nodes (19): coil(), depthOf(), dotGrid(), fitProjection(), iso(), pathOf(), pointsAt(), sideRing() (+11 more)

### Community 48 - "Factory Camera Navigation"
Cohesion: 0.19
Nodes (21): clamp(), FloorView, floorViewport, orbit(), zoomAt(), fromViewCentre(), Gesture, midpoint() (+13 more)

### Community 49 - "Simulation Settings And Results"
Cohesion: 0.14
Nodes (18): DesignProblem, formatDuration(), formatSimTime(), MACHINE_TYPES, MachineState, SimulationResult, PlaybackView, Selection (+10 more)

### Community 50 - "Dashboard Metrics API"
Cohesion: 0.25
Nodes (20): average(), chart(), completed(), corrections(), decision_times(), group_points(), kpi_tiles(), kpis() (+12 more)

### Community 51 - "RabbitMQ Message Delivery"
Cohesion: 0.16
Nodes (14): RabbitBroker, agent_queue(), get_broker(), Consume a queue forever. Agents: run_consumer("agent.material", handle) (bound…, Tests use this to install an InMemoryBroker., run_consumer(), set_broker(), Shared messaging library (contract section D). Import from here. (+6 more)

### Community 52 - "Factory Docker Services"
Cohesion: 0.17
Nodes (21): alembic, uvicorn[standard], Maintenance agent service, Material agent service, Monitoring agent service, Order agent service, Planning agent service, Quality agent service (+13 more)

### Community 53 - "Live Factory Floor"
Cohesion: 0.21
Nodes (16): FloorMachine, FloorOut, LiveEventDataMap, MachineOverview, MachineStatus, useDemoEvents(), QueryNotice(), emptyMachines (+8 more)

### Community 54 - "Machine Operations And Chat"
Cohesion: 0.22
Nodes (17): ManualSource, slot_for(), breakdown(), find_machine(), floor(), output(), overview(), get (+9 more)

### Community 55 - "In Memory Message Broker"
Cohesion: 0.19
Nodes (16): Delivery, Brokers: RabbitBroker (aio-pika) for real use, InMemoryBroker for tests.…, A received message, independent of the broker., AMQP topic matching: '*' is one word, '#' is zero or more words., topic_matches(), make_delivery_handler(), Wraps an envelope handler with schema checks, idempotency, retries and dead-…, Envelope (+8 more)

### Community 56 - "Backend Pinned Dependencies"
Cohesion: 0.10
Nodes (20): aio-pika, asyncpg, bcrypt, Backend pinned dependencies, fastapi, httpx, openpyxl, ortools (+12 more)

### Community 57 - "Isometric Geometry Types"
Cohesion: 0.17
Nodes (17): mapCamera, { stationArt, ringArt, railArt, roomArt, ducts }, cartTrack(), MachineKind, machineKinds, canvas, GeometryDetail, Ink (+9 more)

### Community 58 - "Isometric Projection Helpers"
Cohesion: 0.14
Nodes (20): strip(), cameraOf(), convexHull(), dotGrid(), extrude(), iso(), knurl(), oriented() (+12 more)

### Community 59 - "React Isometric Drawing"
Cohesion: 0.14
Nodes (14): Flat, KeyMark, LegendKey, LineTone, SolidPaths, Tone, Dots(), IsoFigureProps (+6 more)

### Community 60 - "Orchestrator Outbox Recovery"
Cohesion: 0.23
Nodes (18): ApprovalDecisionIn, allowed(), approval_query(), compare_quote(), decide(), get_row(), inbox(), options_for() (+10 more)

### Community 61 - "Floor Layout API And Tests"
Cohesion: 0.16
Nodes (15): AsyncClient, clean_tables(), client(), db_session(), fake_ai(), fake_broker(), FakeAi, _plain_dsn() (+7 more)

### Community 62 - "Customer Reply And Chat"
Cohesion: 0.19
Nodes (15): main(), close_order(), draft_customer_reply(), AsyncSession, UUID, Draft customer wording around facts computed from the selected option., handle(), main() (+7 more)

### Community 63 - "Quality Inspection Services"
Cohesion: 0.23
Nodes (16): create_plan(), get_plan(), get_records(), Create and verify production inspections., verify(), handle(), get, post (+8 more)

### Community 64 - "AI Request And Usage"
Cohesion: 0.16
Nodes (15): chat(), post, Request, read_tool(), respond(), DailyCostLimitReached, LlmRefused, LlmUnavailable (+7 more)

### Community 65 - "Desktop Development Dependencies"
Cohesion: 0.11
Nodes (19): devDependencies, electron, electron-builder, @playwright/test, @testing-library/jest-dom, @testing-library/react, @types/react, @types/react-dom (+11 more)

### Community 66 - "Supplier Quotation API"
Cohesion: 0.23
Nodes (17): sales_only(), check_date(), create_quotation(), edit_quotation(), get_quotation(), list_quotations(), AsyncSession, get (+9 more)

### Community 67 - "Planning Schedule Verification"
Cohesion: 0.33
Nodes (17): MaintenanceEvent, ScheduleSlot, make_order(), at(), capacity(), options(), fixture, test_as_requested_then_recheck_detects_a_conflict() (+9 more)

### Community 68 - "Time Picker Controls"
Cohesion: 0.16
Nodes (13): isTime(), numbers, pad(), Part, TimePicker(), choosePart(), close(), commit() (+5 more)

### Community 69 - "Simulation Editing And Validation"
Cohesion: 0.16
Nodes (14): LineJob, queueAt(), stateAt(), validateDesign(), countUpTo(), LineSimulatorPage(), addBlock(), changeDesign() (+6 more)

### Community 70 - "Read Only Planning API"
Cohesion: 0.17
Nodes (16): alias, get_schedule(), parse_boundary(), plan_what_if(), AsyncSession, datetime, get, post (+8 more)

### Community 71 - "Theme And Figure Components"
Cohesion: 0.15
Nodes (10): dateFormat, FigurePage(), percentFormat, Plate(), applyTheme(), initTheme(), savedTheme(), ThemeName (+2 more)

### Community 72 - "Floor Editor Design Contracts"
Cohesion: 0.20
Nodes (16): Admin-only layout editing, Floor and machine API compatibility, Floor layout PostgreSQL acceptance checks, Floor editor browser acceptance checks, Saved floor decor catalog, Derived initial floor layout, Floor-edit draft lifecycle, Validated floor resizing (+8 more)

### Community 73 - "Backend Application Startup"
Cohesion: 0.19
Nodes (11): APIRouter, REST routers. Add a module with a `router = APIRouter(...)`; app.main picks it…, create_app(), discover_routers(), lifespan(), FastAPI app. Every module in app/api/ that defines `router` is included…, parametrize, test_missing_required_env_key_stops_start() (+3 more)

### Community 74 - "Runtime Configuration And Fixtures"
Cohesion: 0.24
Nodes (13): Approval, ExtractedField, Orders, PO documents, extraction, plans, approvals, customer messages, quality., check_decisions_replan_and_field_check(), check_every_scenario_reaches_its_state(), check_materials_machines_quality_and_quotes(), check_running_orders_occupy_machines_now(), check_waiting_approvals_have_options_and_one_is_overdue() (+5 more)

### Community 75 - "Desktop Runtime Dependencies"
Cohesion: 0.13
Nodes (15): dependencies, react, react-dom, react-is, react-router-dom, recharts, @tanstack/react-query, zustand (+7 more)

### Community 76 - "Dashboard And Date Controls"
Cohesion: 0.22
Nodes (8): DatePicker(), moveMonth(), navigate(), show(), DatePickerProps, isoDate(), readDate(), shiftDate()

### Community 77 - "Accessible Tooltip Controls"
Cohesion: 0.28
Nodes (13): Hint, TooltipLayer(), clearTimers(), detachDescription(), hide(), onFocusIn(), onFocusOut(), onKeyDown() (+5 more)

### Community 78 - "Material Reservation Services"
Cohesion: 0.24
Nodes (13): effective_settings(), AsyncSession, get, patch, post, Env defaults, overridden by rows in app_settings. Agents should read thresholds…, Wipes every table and loads the demo data again, like `python -m app.simulator…, read_settings() (+5 more)

### Community 79 - "Electron TypeScript Configuration"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+5 more)

### Community 80 - "Simulator Purchase Order Generation"
Cohesion: 0.19
Nodes (10): _order(), skipif, Simulator runtime: demo PO PDFs, mistakes, machine events and breakdowns., test_demo_po_arrives_in_the_orders_mailbox(), test_demo_po_falls_back_to_a_customer_part_without_open_quotations(), test_demo_po_uses_an_open_quotation(), test_each_mistake_changes_the_right_field(), test_every_layout_renders_a_pdf() (+2 more)

### Community 81 - "RabbitMQ Message Delivery"
Cohesion: 0.20
Nodes (4): InMemoryBroker, Consume forever. prefetch=1 gives one-at-a-time processing (used by the…, Test broker. Records every publish; delivers to registered consumers when…, DeliveryHandler

### Community 82 - "Ownership Checker Tests"
Cohesion: 0.44
Nodes (10): commit_file(), git(), make_repo(), CompletedProcess, Path, The ownership checker catches files outside a person's paths and files changed…, run_checker(), test_check_fails_for_file_outside_owned_paths() (+2 more)

### Community 83 - "Lathe Solid Profiles"
Cohesion: 0.40
Nodes (11): arcOf(), bandOfProfile(), bandsOf(), disc(), groupsOf(), lathe(), ringBand(), rodOut() (+3 more)

### Community 84 - "Production Line Canvas"
Cohesion: 0.27
Nodes (10): LineCanvas(), onBlockPointerDown(), onDrop(), onPointerMove(), onPointerUp(), toCanvas(), linkPath(), linkPoints() (+2 more)

### Community 85 - "Orchestrator Operational Contracts"
Cohesion: 0.18
Nodes (11): Durable order state machine, Factory orchestrator services, QC completion gate, Role-filtered WebSockets, Serialized approval decisions, Timezone-aware KPI calculations, Back-dated recovery records, Backup and restore procedure (+3 more)

### Community 86 - "Floor Editor Browser Verification"
Cohesion: 0.24
Nodes (5): cell(), clickCell(), errors, mouseCell(), output

### Community 87 - "Isometric Projection Types"
Cohesion: 0.29
Nodes (10): attrs(), dotsSvg(), fadedSvg(), fadeLineSvg(), figureSvg(), groupSvg(), lineSvg(), pathOf() (+2 more)

### Community 88 - "Isometric React Motion Hooks"
Cohesion: 0.31
Nodes (8): asksForStillness(), follow(), spring, Stage(), useEased(), useInView(), useLoop(), useStillness()

### Community 89 - "Desktop Build Commands"
Cohesion: 0.22
Nodes (9): scripts, build, dev, dev:web, dist, e2e, test, test:watch (+1 more)

### Community 90 - "WebGL Scene Rendering"
Cohesion: 0.25
Nodes (4): burst(), GLSL_ISO, GLSL_TURN, smooth()

### Community 91 - "Shared WebGL Rendering"
Cohesion: 0.25
Nodes (4): burst(), GLSL_ISO, GLSL_TURN, smooth()

### Community 92 - "Ownership Command Tooling"
Cohesion: 0.50
Nodes (8): changed_files(), command_check(), command_overlap(), command_owner(), entry_matches(), load_rules(), main(), owners_of()

### Community 93 - "Desktop Interaction Design Contracts"
Cohesion: 0.25
Nodes (8): Dashboards and chart table views, Desktop page workflows, Global chat notifications and refresh, Keyboard and reduced-motion support, Role-filtered navigation, Shared UI building blocks, P5 browser verification and performance, SVG animation frame gating

### Community 94 - "Desktop Package Identity"
Cohesion: 0.29
Nodes (6): description, main, name, private, type, version

### Community 96 - "Live Factory Figure Contracts"
Cohesion: 0.29
Nodes (7): Transient delivery cart, Live isometric factory floor, Floor snapshots and event refresh, Isometric figures, Machine readouts and operations drawers, Material-result delivery cart assignment, P5 integration requests reference

### Community 97 - "Machine Data Sources"
Cohesion: 0.47
Nodes (4): MachineDataSource, OpcUaSource, MachineRaw, Protocol

### Community 98 - "Electron Main Process"
Cohesion: 0.53
Nodes (4): readSecureStore(), registerIpc(), RENDERER_DIR, SECURE_STORE_FILE()

### Community 99 - "Production Line API Mocks"
Cohesion: 0.40
Nodes (5): LineDesign, find(), lines, SimLineOut, SimLineSummary

### Community 100 - "Agent Map And Infrastructure"
Cohesion: 0.40
Nodes (6): Orchestrator service, Simulator service, Isometric agent map, Agent-map metric scope, Chronological message replay, Directed and deduplicated message parcels

### Community 101 - "Domain Agent Design Contracts"
Cohesion: 0.33
Nodes (6): CP-SAT planning, Domain agent implementation, Material movement ledger, Order intake and extraction, Read-only what-if planning, Transactional schedule locking

### Community 102 - "Desktop Theme Tokens"
Cohesion: 0.60
Nodes (5): Dark theme, Shared desktop design tokens, Layout, spacing and typography tokens, Default light theme, Machine-status theme palettes

### Community 104 - "Responsive UI Verification"
Cohesion: 0.50
Nodes (4): errors, inspect(), out, shot()

### Community 105 - "End To End Launcher"
Cohesion: 0.40
Nodes (4): desktopModules, e2eDirectory, playwrightCli, result

### Community 106 - "Factory Scenario Specification"
Cohesion: 0.50
Nodes (4): Factory test scenarios, Fourteen staged test orders, Generated purchase order layouts, Machine outage scenarios

### Community 108 - "Desktop Installer Configuration"
Cohesion: 0.50
Nodes (4): Build-time server address, DMG and AppImage packaging, Factory Commit installers, NSIS Windows installer

### Community 109 - "Isometric Kit Architecture"
Cohesion: 0.50
Nodes (4): Isometric projection renderer, React drawing components, Vendored Anatomy kit, Visibility-aware live hooks

### Community 111 - "Word Purchase Order Fixture"
Cohesion: 0.50
Nodes (4): ACME customer, Purchase order PO-100, Converted Word purchase order fixture, PX-14 order line

### Community 112 - "Database Backup Script"
Cohesion: 0.83
Nodes (3): fail(), backup.sh script, take_backup()

### Community 116 - "Desktop HTML Bootstrap"
Cohesion: 0.67
Nodes (3): Content Security Policy, Desktop HTML entry point, React root mount

### Community 117 - "Agent Map Visual Reference"
Cohesion: 0.67
Nodes (3): Agent map reference screenshot, Isometric agent control room, Quiet figure framing

### Community 118 - "Factory Floor Visual Reference"
Cohesion: 0.67
Nodes (3): Factory floor reference screenshot, Isometric production hall, Quiet machine interaction framing

### Community 119 - "Desktop Workflow Implementation Plan"
Cohesion: 0.67
Nodes (3): Auto-discovered typed pages, Dashboard contract names, Desktop workflow implementation plan

### Community 120 - "Isometric Figure Implementation Plan"
Cohesion: 0.67
Nodes (3): Figure verification matrix, Isometric figure implementation plan, Reusable machine and station geometry

### Community 121 - "Orchestrator Integration Requests"
Cohesion: 0.67
Nodes (3): Explicit live notification recipients, Orchestrator integration requests, Transactional outbox request

### Community 122 - "Desktop Integration Requests"
Cohesion: 0.67
Nodes (3): Desktop integration assumptions, Plain-text chat tool protocol, Shared dashboard chart names

### Community 123 - "Figure Integration Requests"
Cohesion: 0.67
Nodes (3): Authoritative agent activity gap, Explicit material issue destination, Isometric figure integration requests

## Knowledge Gaps
- **339 isolated node(s):** `factory-backend`, `compile`, `electronProcess`, `RENDERER_DIR`, `name` (+334 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 807 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `Master Data CRUD` to `Material Reservation Services`, `Supplier Quotation API`, `Shared Database Models`, `Floor Layout API And Tests`, `Read Only Planning API`, `Purchase Order Intake Events`, `Database Sessions And Authentication`, `API Schemas And Authentication`, `Purchase Order Intake Events`, `Machine Operations And Audit`, `Material Reservation Services`, `Production Line API`, `Demo Order Scenarios`, `Orchestrator Outbox Recovery`, `Order API Queries`, `Planning Calendar Solver`, `Orchestrator Outbox Recovery`, `Floor Layout API And Tests`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `write_audit()` connect `Planning Calendar Solver` to `Purchase Order Intake Events`, `Database Sessions And Authentication`, `Master Data CRUD`, `Demo Order Scenarios`, `Orchestrator Outbox Recovery`, `Order API Queries`, `Purchase Order Field Extraction`, `Floor Layout API And Tests`, `Material Reservation Services`, `Material Reservation Services`, `Floor Layout API And Tests`, `Purchase Order Intake Events`, `Machine Operations And Audit`, `Material Reservation Services`, `Production Line API`, `Machine Operations And Chat`, `Orchestrator Outbox Recovery`, `Customer Reply And Chat`, `Quality Inspection Services`, `Supplier Quotation API`, `Material Reservation Services`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Desktop Order And Settings Workflows` to `Desktop Live API Transport`, `Desktop Order And Settings Workflows`, `Simulation Editing And Validation`, `Agent Map Activity`, `Desktop Route And Shell`, `Desktop API Contracts`, `Simulation Settings And Results`, `Live Factory Floor`, `Visual Floor Editor`, `Desktop Live API Transport`, `Schedule Calendar UI`, `Material Movement Forms`, `Dialogs And Desktop Bridge`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `TableBase` (e.g. with `create_row()` and `get_or_404()`) actually correct?**
  _`TableBase` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `factory-backend`, `compile`, `electronProcess` to the rest of the system?**
  _339 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Desktop API Contracts` be split into smaller, more focused modules?**
  _Cohesion score 0.05348101265822785 - nodes in this community are weakly interconnected._
- **Should `Simulator Purchase Order Generation` be split into smaller, more focused modules?**
  _Cohesion score 0.05837837837837838 - nodes in this community are weakly interconnected._

## Rebuild Audit

Graph health warning: 647 dangling-endpoint edges, 4 self-loop edges and 411 relationships collapsed by the undirected simple graph. See HEALTH_REPORT.txt. No semantic edges have dangling endpoints.

Full structural extraction: 286 code files, no failed sources. Semantic extraction: 33 cached files and six fully read files. The tokens.css sensitive-file flag was reviewed as a false positive (public theme variables). The Word fixture was converted with installed python-docx after Graphify conversion failed; its complete text is in converted/09-word.md. The unrelated ~/ directory and .impeccable are excluded.

`graphify-out/` contains tracked generated outputs; cache and temporary extraction files remain excluded from Git.
