# Graph Report - Multi-AgentFactory  (2026-11-25)

## Corpus Check
- 285 files · ~155,990 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2419 nodes · 7337 edges · 131 communities (92 shown, 29 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 255 edges (avg confidence: 0.9)
- Token cost: unavailable (agent API did not expose usage)

## Community Hubs (Navigation)
- Material Reservation Services
- Orchestrator Outbox Recovery
- Order Desktop Workflows
- Desktop API Contracts
- Simulator Purchase Order Generation
- Schedule Calendar UI
- Machine Monitoring Services
- Isometric Geometry Primitives
- Lathe Geometry Construction
- Planning Calendar Solver
- Desktop Live API Transport
- Master Data CRUD
- Demo Order Scenarios
- Factory Master Data Scheduling
- Desktop Route And Shell
- AI Request And Usage
- Isometric Projection Types
- Shared Database Models
- Purchase Order Intake Events
- Desktop API Contracts
- Visible Scene Motion
- Quality Inspection Services
- Dashboard And Quality Components
- Live Demo Events
- Order API Queries
- Shared Database Models
- Agent Map Activity
- Authentication And Sessions
- Renderer TypeScript Configuration
- Shared Repository Architecture Contracts
- Database Test Fixtures
- Factory Camera Navigation
- Material Reservation Services
- Demo Purchase Order Fixtures
- Purchase Order Field Extraction
- Supplier Quotation API
- Electron End To End
- Validated Message Broker
- Factory Figure Inspector UI
- Factory And Agent Geometry
- Tube Geometry Construction
- Domain Agent Runtime
- Validated Message Broker
- Order And Machine Status
- React Isometric Drawing
- Validated Message Broker
- Desktop Development Dependencies
- Factory Figure Inspector UI
- Desktop Live API Transport
- Factory And Agent Geometry
- Isometric Projection Types
- Read Only Planning API
- Material Reservation Services
- Settings Administration UI
- Desktop Interaction Design Contracts
- Desktop Runtime Dependencies
- Validated Message Broker
- History And Notifications API
- Electron TypeScript Configuration
- Machine Monitoring Services
- Isometric Projection Types
- Ownership Checker Tests
- Lathe Solid Profiles
- Orchestrator Operational Contracts
- Isometric React Motion Hooks
- Customer Reply And Chat
- Desktop Build Commands
- WebGL Scene Rendering
- Shared WebGL Rendering
- Ownership Command Tooling
- Maintenance Availability WebSockets
- AI Model Configuration Pricing
- Desktop Package Identity
- Visible Scene Motion
- Visual Browser Capture Tests
- Electron Main Process
- Factory Compose Services
- Domain Agent Design Contracts
- Isometric Projection Types
- Responsive UI Verification
- End To End Launcher
- AI Request And Usage
- Factory Scenario Specification
- Backend Pinned Dependencies
- Desktop Installer Configuration
- AI Request And Usage
- Electron Development Launcher
- Desktop HTML Bootstrap
- Agent Map Visual Reference
- Factory Floor Visual Reference
- Desktop Workflow Implementation Plan
- Isometric Figure Implementation Plan
- Orchestrator Integration Requests
- Desktop Integration Requests
- Figure Integration Requests
- Database Backup Script
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
1. `User` - 89 edges
2. `write_audit()` - 70 edges
3. `apiFetch()` - 58 edges
4. `session_scope()` - 56 edges
5. `Order` - 50 edges
6. `TableBase` - 49 edges
7. `ApiModel` - 49 edges
8. `seed()` - 40 edges
9. `iso()` - 34 edges
10. `ScheduleSlot` - 32 edges

## Surprising Connections (you probably didn't know these)
- `handle()` --uses--> `MachineRaw`  [INFERRED]
  backend/app/agents/monitoring/__init__.py → backend/app/schemas/contracts.py
- `handle()` --uses--> `DraftCustomerReplyPayload`  [INFERRED]
  backend/app/agents/order/__main__.py → backend/app/schemas/contracts.py
- `handle()` --uses--> `ExtractDocumentPayload`  [INFERRED]
  backend/app/agents/order/__main__.py → backend/app/schemas/contracts.py
- `draft_customer_reply()` --uses--> `DailyCostLimitReached`  [INFERRED]
  backend/app/agents/order/customer.py → backend/app/llm/client.py
- `draft_customer_reply()` --uses--> `LlmRefused`  [INFERRED]
  backend/app/agents/order/customer.py → backend/app/llm/client.py

## Import Cycles
- None detected.

## Communities (131 total, 29 thin omitted)

### Community 0 - "Material Reservation Services"
Cohesion: 0.06
Nodes (107): active_holds(), balances(), check_and_hold(), confirm_holds(), create_purchase_requests(), expire_holds(), Forecast, latest_check() (+99 more)

### Community 1 - "Orchestrator Outbox Recovery"
Cohesion: 0.07
Nodes (83): ApprovalDecisionIn, allowed(), approval_query(), compare_quote(), decide(), get_row(), inbox(), options_for() (+75 more)

### Community 2 - "Order Desktop Workflows"
Cohesion: 0.07
Nodes (63): apiFetch(), CustomerMessageOut, ExtractedFieldOut, FieldCorrection, MaterialOut, MovementType, Page, PlanOptionOut (+55 more)

### Community 3 - "Desktop API Contracts"
Cohesion: 0.05
Nodes (59): ApiError, registerMock(), ChartOut, CycleCountIn, HolidayOut, MaintenanceWindowOut, MaterialStatusOut, PurchaseRequestOut (+51 more)

### Community 4 - "Simulator Purchase Order Generation"
Cohesion: 0.06
Nodes (58): main(), Application settings loaded from environment variables (.env)., Lets code write `settings.x` while keeping construction lazy (so tests can set…, _SettingsProxy, setup_logging(), main(), Simulator commands. python -m app.simulator seed [--reset] [--scenarios] create…, One event loop for both steps: the database engine is tied to the loop that… (+50 more)

### Community 5 - "Schedule Calendar UI"
Cohesion: 0.06
Nodes (48): KpiTile, MachineOut, ScheduleOut, DatePicker(), moveMonth(), navigate(), show(), DatePickerProps (+40 more)

### Community 6 - "Machine Monitoring Services"
Cohesion: 0.08
Nodes (57): MachineDataSource, ManualSource, OpcUaSource, slot_for(), agent(), agent_messages(), agents(), message_page() (+49 more)

### Community 7 - "Isometric Geometry Primitives"
Cohesion: 0.06
Nodes (55): attrs(), axesAt(), axisVector(), AZIMUTH, cameraOf(), circleRing(), convexHull(), cylinder() (+47 more)

### Community 8 - "Lathe Geometry Construction"
Cohesion: 0.10
Nodes (55): add3(), angleToward(), arcPoints(), bandOf(), BANDS, chains(), circleOf(), cross3() (+47 more)

### Community 9 - "Planning Calendar Solver"
Cohesion: 0.08
Nodes (39): calendar(), cut(), merge(), date, datetime, time, Convert local shifts and machine exclusions to UTC working intervals., Return regular and out-of-shift intervals with holidays removed from both. (+31 more)

### Community 10 - "Desktop Live API Transport"
Cohesion: 0.06
Nodes (39): answerFromMock(), __answerFromMockForTests, API_BASE_URL, ApiFetchOptions, connectSocket(), disconnectLiveEvents(), dispatchLiveEvent(), emitMockEvent() (+31 more)

### Community 11 - "Master Data CRUD"
Cohesion: 0.12
Nodes (50): changed_values(), commit_or_conflict(), create_customer(), create_holiday(), create_machine(), create_part(), create_row(), create_shift() (+42 more)

### Community 12 - "Demo Order Scenarios"
Cohesion: 0.11
Nodes (42): Approval, Order, WorkflowRun, add_scenarios(), _approvals(), _approve_and_reply(), Context, _decide() (+34 more)

### Community 13 - "Factory Master Data Scheduling"
Cohesion: 0.10
Nodes (45): parse_clock(), time, Master data CRUD: users, customers, parts (with BOM and routing), suppliers,…, shift_values(), ApiModel, ApprovalDecisionIn, BomLineIn, BomLineOut (+37 more)

### Community 14 - "Desktop Route And Shell"
Cohesion: 0.09
Nodes (27): Role, TokenResponse, UserOut, App(), route, route, LoginPage(), submit() (+19 more)

### Community 15 - "AI Request And Usage"
Cohesion: 0.10
Nodes (42): Agent, chat(), post, respond(), AiResult, call_ai(), check_daily_limit(), _content_part() (+34 more)

### Community 16 - "Isometric Projection Types"
Cohesion: 0.06
Nodes (40): Camera, ExtrudeOptions, Faded, FadeLineStyle, FigureOptions, FitOptions, LineStyle, PageOptions (+32 more)

### Community 17 - "Shared Database Models"
Cohesion: 0.10
Nodes (38): get_settings(), BomLine, Material, Parts, bills of materials, routings, materials, suppliers, quotations., Routing, Supplier, SupplierItem, StockMovement (+30 more)

### Community 18 - "Purchase Order Intake Events"
Cohesion: 0.10
Nodes (34): flush_events(), AsyncSession, UUID, Persist order events with the originating mutation and deliver after commit., stage_event(), input_blocks(), Purchase order intake, field extraction, and customer drafts., Attachment (+26 more)

### Community 19 - "Desktop API Contracts"
Cohesion: 0.07
Nodes (35): ApprovalDecisionIn, ApprovalPack, ApprovalSummary, BomLineOut, ChartSeries, ChatRequest, CustomerOut, DecimalString (+27 more)

### Community 20 - "Visible Scene Motion"
Cohesion: 0.12
Nodes (28): ducts(), CameraControls(), activateOnKey(), kindFor(), compareDepth(), useFigureFrames(), useMotionVisibility(), clearParcel() (+20 more)

### Community 21 - "Quality Inspection Services"
Cohesion: 0.13
Nodes (27): Publish a machine availability change once per maintenance record and window., scan(), handle(), minutes_behind(), datetime, Machine event ingestion and production progress calculations., create_plan(), get_plan() (+19 more)

### Community 22 - "Dashboard And Quality Components"
Cohesion: 0.10
Nodes (27): AuditEntryOut, QcCheck, QcPlanOut, QcRecordOut, fetchOrNull(), DataTableProps, PageHeader(), pageIcons (+19 more)

### Community 23 - "Live Demo Events"
Cohesion: 0.12
Nodes (27): AgentMessageEventData, AgentName, JobRef, actions, active, bays, broadcastDemoMessage(), changeDemoMachine() (+19 more)

### Community 24 - "Order API Queries"
Cohesion: 0.18
Nodes (31): confirm_fields(), download_document(), field_rows(), get_customer_message(), get_fields(), get_material_status(), latest_message(), list_orders() (+23 more)

### Community 25 - "Shared Database Models"
Cohesion: 0.15
Nodes (23): Base, Declarative base with the columns every table shares., Abstract base: UUID primary key plus created/updated timestamps (UTC)., TableBase, Holiday, Machines, working calendar, machine and maintenance events., All database models. Import from here: `from app.models import Order`., PurchaseRequest (+15 more)

### Community 26 - "Agent Map Activity"
Cohesion: 0.15
Nodes (28): AgentMessageOut, AgentSummary, HealthOut, MapAgent, Station, stations, itemsOf(), percent() (+20 more)

### Community 27 - "Authentication And Sessions"
Cohesion: 0.10
Nodes (26): health(), login(), me(), AsyncSession, get, post, REST routers. Add a module with a `router = APIRouter(...)`; app.main picks it…, get_session() (+18 more)

### Community 28 - "Renderer TypeScript Configuration"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, checkJs, esModuleInterop, isolatedModules, jsx, lib, module (+21 more)

### Community 29 - "Shared Repository Architecture Contracts"
Cohesion: 0.07
Nodes (29): Auto-discovered desktop routes, Auto-discovered global panels, One approval commitment workflow, Role-based business access, Shared repository contract, Shared REST and event contracts, Temporary inventory holds, Validated idempotent messaging (+21 more)

### Community 30 - "Database Test Fixtures"
Cohesion: 0.11
Nodes (23): async_sessionmaker, AsyncClient, AsyncEngine, get_engine(), get_session_factory(), AsyncSession, Async database engine and sessions., clean_tables() (+15 more)

### Community 31 - "Factory Camera Navigation"
Cohesion: 0.16
Nodes (25): clamp(), floorCentre, FloorView, floorViewport, initialView, orbit(), Pair, wrap() (+17 more)

### Community 32 - "Material Reservation Services"
Cohesion: 0.17
Nodes (25): add_movement(), cycle_count(), get_material(), list_holds(), list_materials(), lock_material(), material_rows(), movements() (+17 more)

### Community 33 - "Demo Purchase Order Fixtures"
Cohesion: 0.17
Nodes (24): Part, Quotation, Customer, build_test_files(), _demo(), _lathe_only_parts(), Line, date (+16 more)

### Community 34 - "Purchase Order Field Extraction"
Cohesion: 0.17
Nodes (22): extract_document(), ExtractionModel, field_rows(), FieldValue, find_previous_order(), match_customer(), match_part(), parse_date() (+14 more)

### Community 35 - "Supplier Quotation API"
Cohesion: 0.17
Nodes (23): WhatIfRequest, what_if(), flush_or_conflict(), sales_only(), check_date(), create_quotation(), edit_quotation(), get_quotation() (+15 more)

### Community 36 - "Electron End To End"
Cohesion: 0.20
Nodes (20): api(), API_BASE_URL, apiToken(), ApprovalSummary, bringOrderToApproval(), launchDesktop(), logIn(), logInAsManager() (+12 more)

### Community 37 - "Validated Message Broker"
Cohesion: 0.17
Nodes (22): For workers: commit on success, roll back on error., session_scope(), UsageTotals, _already_processed(), ContractError, _json_ready(), _mark_processed(), publish_event() (+14 more)

### Community 38 - "Factory Figure Inspector UI"
Cohesion: 0.19
Nodes (17): FloorMachine, FloorOut, LiveEventDataMap, MachineOverview, MachineStatus, Inspector(), useDemoEvents(), formatDateTime() (+9 more)

### Community 39 - "Factory And Agent Geometry"
Cohesion: 0.25
Nodes (20): createMapArt(), bin(), desk(), screen(), segment(), spurArt(), floorArt(), assemble() (+12 more)

### Community 40 - "Tube Geometry Construction"
Cohesion: 0.16
Nodes (19): coil(), depthOf(), dotGrid(), fitProjection(), iso(), pathOf(), pointsAt(), sideRing() (+11 more)

### Community 41 - "Domain Agent Runtime"
Cohesion: 0.20
Nodes (16): Material reservation and purchasing agent., expire_periodically(), handle(), main(), handle(), main(), handle(), publish_result() (+8 more)

### Community 42 - "Validated Message Broker"
Cohesion: 0.19
Nodes (15): Delivery, InMemoryBroker, Brokers: RabbitBroker (aio-pika) for real use, InMemoryBroker for tests.…, Test broker. Records every publish; delivers to registered consumers when…, A received message, independent of the broker., AMQP topic matching: '*' is one word, '#' is zero or more words., topic_matches(), make_delivery_handler() (+7 more)

### Community 43 - "Order And Machine Status"
Cohesion: 0.16
Nodes (18): OrderState, stateLabel(), FINISHED, MachineStatusBadge(), NEEDS_ACTION, OrderStatusBadge(), orderTone(), PROBLEM (+10 more)

### Community 44 - "React Isometric Drawing"
Cohesion: 0.14
Nodes (14): Flat, KeyMark, LegendKey, LineTone, SolidPaths, Tone, Dots(), IsoFigureProps (+6 more)

### Community 45 - "Validated Message Broker"
Cohesion: 0.13
Nodes (8): RabbitBroker, Consume forever. prefetch=1 gives one-at-a-time processing (used by the…, Tests use this to install an InMemoryBroker., set_broker(), skipif, Round trip through a real RabbitMQ. Skipped when RABBITMQ_URL is not reachable., test_task_round_trip_through_rabbitmq(), DeliveryHandler

### Community 46 - "Desktop Development Dependencies"
Cohesion: 0.11
Nodes (19): devDependencies, electron, electron-builder, @playwright/test, @testing-library/jest-dom, @testing-library/react, @types/react, @types/react-dom (+11 more)

### Community 47 - "Factory Figure Inspector UI"
Cohesion: 0.13
Nodes (11): queryClient, dateFormat, FigurePage(), percentFormat, Plate(), applyTheme(), initTheme(), savedTheme() (+3 more)

### Community 48 - "Desktop Live API Transport"
Cohesion: 0.19
Nodes (12): ChatPanelState, useChatPanel, ChatMessage, ChatPanel(), send(), submit(), SUGGESTIONS, ChatGlobal() (+4 more)

### Community 49 - "Factory And Agent Geometry"
Cohesion: 0.18
Nodes (16): mapCamera, { stationArt, ringArt, railArt, roomArt, ducts }, cartTrack(), MachineKind, machineKinds, canvas, Ink, roomCamera() (+8 more)

### Community 50 - "Isometric Projection Types"
Cohesion: 0.16
Nodes (18): cameraOf(), convexHull(), dotGrid(), extrude(), iso(), knurl(), oriented(), pointsAt() (+10 more)

### Community 51 - "Read Only Planning API"
Cohesion: 0.18
Nodes (15): alias, get_schedule(), parse_boundary(), plan_what_if(), AsyncSession, datetime, get, post (+7 more)

### Community 52 - "Material Reservation Services"
Cohesion: 0.20
Nodes (15): effective_settings(), AsyncSession, get, patch, post, Env defaults, overridden by rows in app_settings. Agents should read thresholds…, Wipes every table and loads the demo data again, like `python -m app.simulator…, read_settings() (+7 more)

### Community 53 - "Settings Administration UI"
Cohesion: 0.16
Nodes (12): SettingsOut, ConfirmDialog(), route, DemoTab(), MachinesTab(), ROLES, SettingsPage(), Tab (+4 more)

### Community 54 - "Desktop Interaction Design Contracts"
Cohesion: 0.12
Nodes (16): Isometric projection renderer, React drawing components, Vendored Anatomy kit, Visibility-aware live hooks, Dashboards and chart table views, Desktop page workflows, Global chat notifications and refresh, Keyboard and reduced-motion support (+8 more)

### Community 55 - "Desktop Runtime Dependencies"
Cohesion: 0.13
Nodes (15): dependencies, react, react-dom, react-is, react-router-dom, recharts, @tanstack/react-query, zustand (+7 more)

### Community 56 - "Validated Message Broker"
Cohesion: 0.23
Nodes (10): agent_queue(), get_broker(), Consume a queue forever. Agents: run_consumer("agent.material", handle) (bound…, run_consumer(), task_routing_key(), Shared messaging library (contract section D). Import from here., Durable factory workflow coordination., main() (+2 more)

### Community 57 - "History And Notifications API"
Cohesion: 0.29
Nodes (13): audit_query(), csv_value(), export_csv(), history(), history_time(), mark_read(), notifications(), date (+5 more)

### Community 58 - "Electron TypeScript Configuration"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+5 more)

### Community 59 - "Machine Monitoring Services"
Cohesion: 0.20
Nodes (8): APIRouter, Settings, discover_routers(), parametrize, test_missing_required_env_key_stops_start(), test_router_discovery_picks_up_new_module(), test_default_prices_are_grafilabs(), BaseSettings

### Community 60 - "Isometric Projection Types"
Cohesion: 0.23
Nodes (12): strip(), attrs(), dotsSvg(), fadedSvg(), fadeLineSvg(), figureSvg(), groupSvg(), lineSvg() (+4 more)

### Community 61 - "Ownership Checker Tests"
Cohesion: 0.44
Nodes (10): commit_file(), git(), make_repo(), CompletedProcess, Path, The ownership checker catches files outside a person's paths and files changed…, run_checker(), test_check_fails_for_file_outside_owned_paths() (+2 more)

### Community 62 - "Lathe Solid Profiles"
Cohesion: 0.40
Nodes (11): arcOf(), bandOfProfile(), bandsOf(), disc(), groupsOf(), lathe(), ringBand(), rodOut() (+3 more)

### Community 63 - "Orchestrator Operational Contracts"
Cohesion: 0.18
Nodes (11): Durable order state machine, Factory orchestrator services, QC completion gate, Role-filtered WebSockets, Serialized approval decisions, Timezone-aware KPI calculations, Back-dated recovery records, Backup and restore procedure (+3 more)

### Community 64 - "Isometric React Motion Hooks"
Cohesion: 0.31
Nodes (8): asksForStillness(), follow(), spring, Stage(), useEased(), useInView(), useLoop(), useStillness()

### Community 65 - "Customer Reply And Chat"
Cohesion: 0.39
Nodes (8): close_order(), draft_customer_reply(), AsyncSession, UUID, Draft customer wording around facts computed from the selected option., DraftCustomerReplyResult, test_split_draft_and_close_use_database_facts(), ValueError

### Community 66 - "Desktop Build Commands"
Cohesion: 0.22
Nodes (9): scripts, build, dev, dev:web, dist, e2e, test, test:watch (+1 more)

### Community 67 - "WebGL Scene Rendering"
Cohesion: 0.25
Nodes (4): burst(), GLSL_ISO, GLSL_TURN, smooth()

### Community 68 - "Shared WebGL Rendering"
Cohesion: 0.25
Nodes (4): burst(), GLSL_ISO, GLSL_TURN, smooth()

### Community 69 - "Ownership Command Tooling"
Cohesion: 0.50
Nodes (8): changed_files(), command_check(), command_overlap(), command_owner(), entry_matches(), load_rules(), main(), owners_of()

### Community 70 - "Maintenance Availability WebSockets"
Cohesion: 0.43
Nodes (7): expose_desktop_url(), project_event(), subscribe(), websocket(), decode_access_token(), Raises jwt.PyJWTError when the token is invalid or expired., test_ws_role_and_notification_recipients()

### Community 71 - "AI Model Configuration Pricing"
Cohesion: 0.32
Nodes (7): cost_usd(), prices(), Decimal, USD per million tokens per model, set in .env as AI_PRICES: [input, output,…, tokens_in includes cached_tokens_in, as the provider reports it., test_bad_prices_json_counts_as_zero(), test_cost_uses_prices_from_env_and_zero_for_unknown_models()

### Community 72 - "Desktop Package Identity"
Cohesion: 0.29
Nodes (6): description, main, name, private, type, version

### Community 75 - "Electron Main Process"
Cohesion: 0.53
Nodes (4): readSecureStore(), registerIpc(), RENDERER_DIR, SECURE_STORE_FILE()

### Community 76 - "Factory Compose Services"
Cohesion: 0.33
Nodes (6): Backup service, Factory Compose services, GreenMail demo intake, Independent agent containers, PostgreSQL shared database, RabbitMQ message broker

### Community 77 - "Domain Agent Design Contracts"
Cohesion: 0.33
Nodes (6): CP-SAT planning, Domain agent implementation, Material movement ledger, Order intake and extraction, Read-only what-if planning, Transactional schedule locking

### Community 78 - "Isometric Projection Types"
Cohesion: 0.50
Nodes (5): axesAt(), matrixOf(), sideMatrix(), thousandth(), topMatrix()

### Community 79 - "Responsive UI Verification"
Cohesion: 0.50
Nodes (4): errors, inspect(), out, shot()

### Community 80 - "End To End Launcher"
Cohesion: 0.40
Nodes (4): desktopModules, e2eDirectory, playwrightCli, result

### Community 81 - "AI Request And Usage"
Cohesion: 0.67
Nodes (3): add_usage(), Decimal, Collects LLM token usage while one message is being handled, so its result can…

### Community 82 - "Factory Scenario Specification"
Cohesion: 0.50
Nodes (4): Factory test scenarios, Fourteen staged test orders, Generated purchase order layouts, Machine outage scenarios

### Community 83 - "Backend Pinned Dependencies"
Cohesion: 0.50
Nodes (4): Backend pinned dependencies, Document conversion libraries, FastAPI SQLAlchemy stack, OR-Tools CP-SAT

### Community 84 - "Desktop Installer Configuration"
Cohesion: 0.50
Nodes (4): Build-time server address, DMG and AppImage packaging, Factory Commit installers, NSIS Windows installer

### Community 85 - "AI Request And Usage"
Cohesion: 0.67
Nodes (3): parse_json_text(), Any, Models sometimes wrap JSON in ```json fences even when asked for JSON only.

### Community 88 - "Desktop HTML Bootstrap"
Cohesion: 0.67
Nodes (3): Content Security Policy, Desktop HTML entry point, React root mount

### Community 89 - "Agent Map Visual Reference"
Cohesion: 0.67
Nodes (3): Agent map reference screenshot, Isometric agent control room, Quiet figure framing

### Community 90 - "Factory Floor Visual Reference"
Cohesion: 0.67
Nodes (3): Factory floor reference screenshot, Isometric production hall, Quiet machine interaction framing

### Community 91 - "Desktop Workflow Implementation Plan"
Cohesion: 0.67
Nodes (3): Auto-discovered typed pages, Dashboard contract names, Desktop workflow implementation plan

### Community 92 - "Isometric Figure Implementation Plan"
Cohesion: 0.67
Nodes (3): Figure verification matrix, Isometric figure implementation plan, Reusable machine and station geometry

### Community 93 - "Orchestrator Integration Requests"
Cohesion: 0.67
Nodes (3): Explicit live notification recipients, Orchestrator integration requests, Transactional outbox request

### Community 94 - "Desktop Integration Requests"
Cohesion: 0.67
Nodes (3): Desktop integration assumptions, Plain-text chat tool protocol, Shared dashboard chart names

### Community 95 - "Figure Integration Requests"
Cohesion: 0.67
Nodes (3): Authoritative agent activity gap, Explicit material issue destination, Isometric figure integration requests

## Knowledge Gaps
- **265 isolated node(s):** `factory-backend`, `compile`, `electronProcess`, `RENDERER_DIR`, `name` (+260 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 665 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `Master Data CRUD` to `Material Reservation Services`, `Orchestrator Outbox Recovery`, `Material Reservation Services`, `Supplier Quotation API`, `Machine Monitoring Services`, `Maintenance Availability WebSockets`, `Demo Order Scenarios`, `Factory Master Data Scheduling`, `Shared Database Models`, `Purchase Order Intake Events`, `Read Only Planning API`, `Material Reservation Services`, `Quality Inspection Services`, `Database Test Fixtures`, `Order API Queries`, `History And Notifications API`, `Authentication And Sessions`, `Shared Database Models`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `write_audit()` connect `Material Reservation Services` to `Material Reservation Services`, `Customer Reply And Chat`, `Purchase Order Field Extraction`, `Orchestrator Outbox Recovery`, `Supplier Quotation API`, `Machine Monitoring Services`, `Master Data CRUD`, `Demo Order Scenarios`, `Factory Master Data Scheduling`, `Purchase Order Intake Events`, `Material Reservation Services`, `Quality Inspection Services`, `Order API Queries`, `History And Notifications API`, `Authentication And Sessions`, `Shared Database Models`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `session_scope()` connect `Validated Message Broker` to `Material Reservation Services`, `Orchestrator Outbox Recovery`, `Purchase Order Field Extraction`, `Demo Purchase Order Fixtures`, `Simulator Purchase Order Generation`, `Maintenance Availability WebSockets`, `Domain Agent Runtime`, `Demo Order Scenarios`, `AI Request And Usage`, `Shared Database Models`, `Purchase Order Intake Events`, `Quality Inspection Services`, `Database Test Fixtures`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `factory-backend`, `compile`, `electronProcess` to the rest of the system?**
  _265 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Material Reservation Services` be split into smaller, more focused modules?**
  _Cohesion score 0.05697151424287856 - nodes in this community are weakly interconnected._
- **Should `Orchestrator Outbox Recovery` be split into smaller, more focused modules?**
  _Cohesion score 0.06764346764346764 - nodes in this community are weakly interconnected._
- **Should `Order Desktop Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.07058823529411765 - nodes in this community are weakly interconnected._

## Extraction audit

Semantic extraction covered 36 files. Actual agent token usage was not available through the agent API; reported zero token counts mean unavailable, not zero cost.

The installed Graphify package is 0.9.53 while its skill is 0.9.109; equivalent explicit coverage validation was used because drop_unreported_chunk_sources is unavailable.

`graphify-out/` was written into the working tree and will show in git status unless ignored.


## Graph health audit

The extraction diagnostic reports 544 dangling endpoint edges, one self-loop, and 355 endpoint-pair collapses in the undirected graph. All dangling edges originate in AST extraction: 522 reference external packages or standard-library modules, 12 reference CSS imports (CSS is outside the AST extractor), eight reference iso-kit JavaScript re-export symbols, and two reference the destructured stationArt export. This is an extraction limitation rather than a UI runtime failure. No semantic coverage gaps were found: all 26 documents, seven PDFs and three original screenshot/scanned-image fixtures were read completely.

The self-loop is a WebSocket annotation/reference in backend/app/api/ws.py. Collapsed pairs chiefly carry several calls/uses/references relationships between the same endpoints; this undirected visualization retains only one graph edge for each pair. See HEALTH_REPORT.txt and health.json for counts and examples.

Generated QA evidence under .impeccable/ was excluded from this corpus and the exclusion was persisted in .graphify_build.json. The final corpus contains 285 files: 249 code files, 26 documents, seven PDFs, and three images. tokens.css was incorrectly flagged as sensitive by detection and the Word fixture could not be converted; neither was semantically extracted. Application theme tokens were inspected directly during the UI implementation.

## UI consistency connections

The refreshed graph verifies both scene modules import the same camera controls and hook: MapScene.tsx imports CameraControls at L7 and useFloorCamera at L9; FloorScene.tsx imports CameraControls at L8 and useFloorCamera at L11. Both use the same floorProjection, locateInView and projectionAngles helpers.

MachineDrawer.tsx imports the shared Inspector at L7 and CompactList at L8. AgentDrawer.tsx imports Inspector at L6 and CompactList at L7. This connects machine and agent selection to the same detail-panel and progressive-disclosure components.

## Query benchmark

Graphify estimates 120,950 words (~161,266 naive tokens) across represented content, an average query cost of ~21,913 tokens, and 7.4x fewer tokens per query across its four built-in benchmark questions. This is a library estimate, not measured agent billing.
