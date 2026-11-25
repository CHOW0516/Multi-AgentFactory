# Domain agents

The P2 workers use the foundation's RabbitMQ contracts, PostgreSQL models, audit helper, Claude wrapper, and runtime settings. FastAPI discovers the Order, Material, Quotation, and Planning routers under `/api`.

## Order

Run `python -m app.agents.order`. The worker polls IMAP using `EMAIL_POLL_SECONDS`. It records all supported attachments from an email in one transaction, stores them under `DOCUMENT_STORAGE_PATH`, and marks the email seen after the received events publish. The upload endpoint uses the same intake service. A plain-text email body can serve as a source document when the message has no attachments.

Message-ID deduplication covers multiple attachments and retries of the same email. The order event outbox records received, revised, and field-confirmed events in the originating transaction. The worker retries pending rows after restart or broker failure. A crash between broker confirmation and marking the event published can cause a redelivery, so consumers should identify the business event by its order ID.

Claude receives PDF and supported image blocks directly. TIFF pages are converted to PNG for the image input. Word paragraphs and tables and Excel worksheets are converted to text. Structured extraction preserves the original field values, confidence, and source excerpts. Catalog matching prefers exact values and then trimmed case-insensitive matches. Ambiguous matches, low confidence, missing required fields, and open-quotation differences go to sales review. Confirming applies valid corrections to the order and its lines, preserves the original extraction, and signals the orchestrator. A matching previously confirmed PO links the replacement order to the original.

Customer drafts take quantities and delivery dates from the stored plan. Claude supplies courtesy wording. Sales sends the reply outside the application and records that action through the API.

## Material

Run `python -m app.agents.material`. The ledger is the source of stock. Active firm and unexpired temporary holds reduce availability. When checking an order, the agent recognizes that order's existing coverage and calculates requirements from all BOM lines and their scrap rate. It rounds each material's aggregate requirement up to the ledger's three-decimal precision.

Reservation, conversion, release, expiry, and inventory movements lock the relevant material rows. A repeated reservation task returns the same stored result. The expiration job runs every minute. Expired holds stop reducing availability immediately, even before cleanup. A recheck detects expired holds and shortages that have grown or slipped. Shortages use the shortest known supplier lead time. Missing lead times remain visible as warnings and prevent promising a schedule. Purchase requests remain drafts.

The store role can post ledger movements and cycle counts. A count records an adjustment for the difference and updates `last_counted_at`. Material totals and stock-count warnings are computed at read time.

## Planning

Run `python -m app.agents.planning` as one worker with prefetch one. CP-SAT enforces routing order, compatible machines, shifts, holidays, outages, locked work, and material readiness. It can spread an operation across working intervals and stores each occupied interval as a separate schedule slot. The solve budget is shared across the options. The explanation records when the solver could not establish feasibility or optimality within the budget.

The worker calculates the shipment date with QC and shipping buffers. It prepares regular, delay, split, overtime, and lower-priority displacement options when applicable. A useful split delivers the largest partial quantity it can by the due date. Displacement considers later-due lower-priority orders first and shows every changed delivery. The recommendation prefers on-time delivery at the lowest extra cost, breaking ties by earlier finish, and uses the earliest full regular plan when on-time delivery is unavailable. Margin uses the BOM materials' unit costs where present and discloses missing costs.

Proposals are tentative. A lock rechecks the selected slots and the locked slots it would replace against the current schedule and calendar. The chosen work, displaced work, and discarded alternatives update in one transaction. A replan for a started order retains completed work and reschedules unstarted slots. If a breakdown interrupts an active operation, the worker records that it needs a production count to establish the remaining quantity. The quote and planning what-if routes use the same inventory and capacity calculations without persisting holds, options, or slots.

## Validation

Run from `backend` with `TEST_DATABASE_URL` pointing at a dedicated PostgreSQL test database. The shared fixture recreates that database.

```sh
python -m pytest tests/domain tests/foundation
```

Domain coverage includes ten synthetic PO files, quotation and revision checks, sales corrections, duplicate IMAP intake, broker recovery, reservation concurrency and expiry, due-date feasibility, split and overtime arithmetic, moving locked work, holidays and maintenance, time limits, stale plans, machine replans, read-only what-if calls, and API roles. Set `RUN_LIVE_LLM_TESTS=1` and provide `AI_API_KEY` to opt in to the live extraction test.
