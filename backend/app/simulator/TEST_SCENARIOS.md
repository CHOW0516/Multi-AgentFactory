# Test data: scenarios and test POs

Two tools for testing the whole app by hand.

## 1. Load the test scenarios

This wipes the database and loads the demo seed plus 14 test orders in different states.

```
docker compose run --rm seed python -m app.simulator seed --reset --scenarios
```

It takes about 30 seconds, because the real planner plans the orders. The AI is not called.
Start the agents, orchestrator and simulator afterwards (or keep them running) so the live parts below move.

Test orders are named `SO-<year>-T001` to `T014`. Their PO numbers look like `ACME-TEST-006`.

| Order | State | What to test |
|---|---|---|
| T001 | In production | LATHE-01 is busy for about 3.5 days. New lathe orders must be planned around it. |
| T002 | In production | LATHE-02 is busy for about 2.5 days. Has one **QC fail** (diameter out of tolerance) and a scrap movement. |
| T003 | In production | Laser step done, the **press brake** is running now. |
| T004 | In production | Almost done: on the QC station, most QC checks passed. Record the last check on the Quality page; when the slots finish, the order should close as COMPLETED. |
| T005 | In production | The **laser** is booked for about 40 hours, so new sheet-metal orders must queue. |
| T006 | Waiting approval | Easy order that matches its quotation. Approve it. |
| T007 | Waiting approval | Due in 3 working days on the busy lathes, so only a **delay** option is offered. Waiting 9 hours, so the orchestrator sends a **reminder** and **escalates** to the backup manager (Daniel) on its next tick. |
| T008 | Waiting approval | Its main material is almost out of stock (**shortage**). After approval a purchase request should appear. |
| T009 | Reply drafted | Approved; plan locked; firm stock holds; QC plan; customer reply waiting for sales to send. Also has a draft purchase request for a short material. |
| T010 | Customer replied | Approved and the reply was sent. Starts production when its slots begin (with the simulator running). |
| T011 | Declined | Manager declined it (price far below cost, date impossible). Decline reply drafted. |
| T012 | Replan needed | Manager sent it back ("no overtime, try split delivery"). The orchestrator re-plans it and a new approval appears with what changed. |
| T013 | Needs field check | Faxed PO with a wrong revision, a price 10% below the quote and a low-confidence date. Sales fixes and confirms the fields. |
| T014 | Failed | Extraction failed (AI timeout). Test retry or manual handling. |

Also loaded:

- **MILL-02 is down** (broken 2 hours ago, repair expected in 6 hours). New orders must not use it.
- **BRAKE-01 has planned maintenance** 3 working days from now, 08:00 to 13:00.
- A past breakdown on LATHE-02 last week (for downtime charts).
- **Low stock**: two materials below minimum. M8-PEM-NUT has a purchase request already sent to the supplier.
- Quotations: one **accepted** and one **expired**.

Live tests you can do on top of this:

- **Breakdown during a running job**: on the Factory floor, report a breakdown on LATHE-01. T001 must be re-planned and the manager asked to approve the new plan.
- **New order around running work**: upload `13-rush-3-days.pdf` (below). The plan must avoid the busy lathes and the down mill.

## 2. Make the test PO files

After step 1, run:

```
docker compose run --rm -v "${PWD}/test-pos:/out" seed python -m app.simulator test-pos --out /out
```

This writes 21 PDFs and a `README.md` into the `test-pos` folder. The README says what each file tests and what
should happen. The files use real customers, parts and quotations from the database, and dates relative to
today, so make a new set if you test on another day.

Upload them on the Orders page (sales user), or email them to the orders inbox.

| Files | What they test |
|---|---|
| 01 to 03 | Clean POs in three layouts that match a quotation. |
| 04, 05 | Messy: faxed scan; informal email with no table. |
| 06 to 08 | Missing due date; missing PO number; missing revision and price. |
| 09 to 12 | Wrong revision; price below quote; different quantity; unclear date (03/04/27). |
| 13 to 16 | Rush (3 days); due on a public holiday; due date already passed; 20,000 pcs. These should give delay suggestions. |
| 17, 18 | Unknown part number; unknown customer. |
| 19, 20 | Duplicate of T010's PO; revision 2 of T009's PO. |
| 21 | Three lines, one using the short material. |

Demo users all use the admin password from `.env` (`ADMIN_INITIAL_PASSWORD`):
manager@factory.local, manager2@factory.local, sales@factory.local, planner@factory.local,
store@factory.local, qc@factory.local.
