# Runbook

How to run, stop, back up and restore the system, and what to do when it is down.
All commands run from the repository root on the server machine.

## 1. First start

```bash
cp .env.example .env          # then fill in every "change-me" value and ANTHROPIC_API_KEY
docker compose up -d postgres rabbitmq greenmail
docker compose run --rm migrate
docker compose run --rm seed  # demo data + the admin user from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD
docker compose up -d
```

Check it is healthy:

```bash
docker compose ps                         # every service "running" or "healthy"
curl http://localhost:8000/api/health     # {"status":"ok","database":true,...}
```

Then open the desktop app and sign in. In production, set `APP_MODE=production` and stop the
`simulator` and `greenmail` services (`docker compose stop simulator greenmail`); point
`IMAP_*` and `SMTP_*` at the real mailbox.

## 2. Daily start and stop

| What | Command |
|---|---|
| Start everything | `docker compose up -d` |
| Stop everything (data is kept) | `docker compose stop` |
| Restart one agent | `docker compose restart agent-planning` |
| See logs of one service | `docker compose logs -f --tail 200 orchestrator` |
| Update to a new version | `git pull && docker compose build && docker compose up -d` (the API runs migrations on start) |

Never use `docker compose down -v`: `-v` deletes the database volume.

Messages are never lost while an agent is stopped. They wait in RabbitMQ and are handled when it
starts again. Failed messages end up in a `<queue>.dlq` queue; check them in the RabbitMQ UI at
http://localhost:15672.

## 3. Demo mode

Only when `APP_MODE=demo`:

| What | Command |
|---|---|
| Send one demo PO now | `docker compose run --rm simulator python -m app.simulator send-po` |
| Wipe everything and re-seed | `docker compose stop simulator && docker compose run --rm seed python -m app.simulator reset && docker compose start simulator` |
| Change how often POs arrive | `SIM_PO_INTERVAL_SECONDS` in `.env`, then `docker compose up -d simulator` |

About one demo PO in three has a deliberate mistake (wrong revision, different quantity or price,
or a date like `12/05/26` that can be read two ways) so the field check has something to catch.
The demo PDFs come in five layouts, including a "faxed" one that is tilted and noisy.

## 4. Backups

The `backup` service takes a `pg_dump` on the `BACKUP_CRON` schedule (default hourly) and keeps the
newest `BACKUP_KEEP` dumps (default 72) in `./backups` on the host. It also takes one dump each
time it starts.

| What | Command |
|---|---|
| Take a backup now | `docker compose run --rm backup once` |
| List backups | `scripts/restore.sh` |
| See backup log | `docker compose logs backup` |

Copy `./backups` to another machine or cloud storage every day. A backup that only lives on the
same disk as the database does not survive a disk failure. Uploaded PO files live in the
`documents` volume; back it up too, for example:

```bash
docker run --rm -v factory-commit_documents:/data -v "$PWD/backups":/out alpine \
  tar czf /out/documents-$(date +%Y%m%d).tar.gz -C /data .
```

For production, prefer a managed PostgreSQL with point-in-time restore over hourly dumps.

## 5. Restore

```bash
scripts/restore.sh                                     # list backups, newest first
scripts/restore.sh factory-20261124-090000.dump --yes  # restore one
```

The script stops the API, orchestrator, agents and simulator, replaces **all** data with the dump
in one transaction, then starts the stopped services again. If the restore fails, nothing is
changed. Anything entered after the backup time is lost, so after a restore:

1. Tell the team the time of the backup.
2. Re-enter what happened since then from emails, paper slips and the shop floor (section 6).
3. Check open orders on the Orders page; resend any PO email that arrived after the backup time.

Test a restore once a month on a spare machine, so you know it works before you need it.

## 6. When the system is down: paper fallback

The factory keeps working without the system. Keep a printed stack of these forms at the store,
the planning desk and QC.

**Store slip** (one line per movement):
date and time · material code · quantity (+ in, − out) · type (receive / issue / scrap / return /
adjust) · order or PO number · name · slip number

**Order sheet** (one per new PO): PO number · customer · part and revision · quantity · price ·
due date · who checked it · manager's signature for approval

**Machine sheet** (one per machine per shift): start and stop times · order number · good count ·
scrap count · breakdowns (from / to / reason)

**QC sheet**: order number · sample count · pass / fail · inspector

Rules while down:

- The manager signs the order sheet instead of approving in the app. Sales confirms the price to
  the customer as usual, from the quotation file.
- Planners book machines on the whiteboard; do not promise new dates you cannot check.
- Keep all slips in one tray, in time order.

## 7. Entering back-dated records after an outage

When the system is back, enter the paper slips **oldest first**, before starting any new work.

- **Stock movements**: Materials → Stock movement. Enter each store slip. Put the slip number in
  *Reference* and write `Paper slip, happened <date time>` in *Reason*. The movement keeps today's
  entry time, but the stock balance comes out right because it is the sum of all movements.
  Finish with a cycle count of the materials you touched, so the system and the shelf agree.
- **Orders that arrived while down**: forward or re-upload each PO so the Order agent extracts it.
  If the manager already signed the paper order sheet, approve it in the app and write
  `Approved on paper <date>` in the comment, so the audit log shows the real approval.
- **Machine and QC sheets**: enter breakdowns on the Machines page and QC results on the Quality
  page, with the real times from the sheet.
- After everything is entered, check open orders on the Orders page. Report any breakdown you entered
  so the orchestrator re-plans the affected orders; a plan that no longer fits comes back to the
  approval inbox as a replan.

## 8. Common problems

| Symptom | What to check |
|---|---|
| App says "cannot reach server" | `curl http://localhost:8000/api/health`; `docker compose ps`; firewall on port 8000 |
| New POs are not picked up | `docker compose logs agent-order`; IMAP settings in `.env`; mailbox password |
| An order is stuck in one state | Orders page → timeline shows the last message; check that agent's logs and its `.dlq` queue |
| "Daily AI cost limit reached" | Raise `LLM_DAILY_COST_LIMIT_USD` in Settings, or wait until tomorrow; PO extraction still works |
| Database full or slow | `docker system df`; prune old backups; check `BACKUP_KEEP` |
| Forgot a password | An admin resets it in Settings → Users. If no admin can sign in, contact the developer; do not edit the database by hand |
