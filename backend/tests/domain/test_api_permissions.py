from datetime import date
from pathlib import Path

from sqlalchemy import select

from app.models import AuditLog, CustomerMessage, WorkflowRun


async def test_order_permissions_and_upload(
    client, auth_headers, catalog, make_order, db_session, fake_broker
):
    sales, store, manager = (auth_headers(role) for role in ("sales", "store", "manager"))
    path = Path(__file__).parent / "fixtures" / "pos" / "01-standard.pdf"
    response = await client.post(
        "/api/orders/upload",
        headers=sales,
        files={
            "file": (path.name, path.read_bytes(), "application/pdf"),
        },
    )
    assert response.status_code == 201, response.text
    received = response.json()
    assert received["status"] == "RECEIVED"
    assert len(fake_broker.published_to("event.order.received")) == 1
    url = f"/api/orders/{received['id']}"
    document = await client.get(url + "/document", headers=sales)
    assert document.status_code == 200 and document.content == path.read_bytes()
    assert (await client.get(url + "/document", headers=store)).status_code == 403
    assert (await client.get(url + "/fields", headers=store)).status_code == 403
    assert (await client.patch(url + "/fields", headers=manager, json=[])).status_code == 403
    assert (await client.post(url + "/fields/confirm", headers=store)).status_code == 403
    assert (await client.get(url + "/plan-options", headers=store)).status_code == 403
    orders = await client.get("/api/orders?status=RECEIVED&page_size=200", headers=store)
    assert orders.json()["items"] == [received]

    order = await make_order(status="REPLY_DRAFTED", due_date=date(2020, 1, 1))
    db_session.add(CustomerMessage(order_id=order.id, subject="Reply", draft_text="A draft."))
    db_session.add(WorkflowRun(order_id=order.id, state="REPLY_DRAFTED", attempts={}))
    await db_session.commit()
    details = await client.get(f"/api/orders/{order.id}", headers=store)
    assert details.json()["lines"][0]["unit_price"] is None
    assert details.json()["late_risk"] is True
    message = f"/api/orders/{order.id}/customer-message"
    assert (await client.get(message, headers=store)).status_code == 403
    assert (await client.post(message + "/sent", headers=manager)).status_code == 403
    sent = await client.post(message + "/sent", headers=sales)
    assert sent.json()["status"] == "sent_by_sales"
    await db_session.refresh(order)
    assert order.status == "CUSTOMER_REPLIED"


async def test_material_and_quotation_permissions(client, auth_headers, catalog, db_session):
    sales, store, manager = (auth_headers(role) for role in ("sales", "store", "manager"))
    movement = {"material_id": str(catalog.material.id), "movement_type": "receive", "quantity": 10}
    assert (await client.post("/api/stock-movements", headers=manager, json=movement)).status_code == 403
    assert (await client.post("/api/stock-movements", headers=store, json=movement)).status_code == 201
    adjustment = movement | {"movement_type": "adjust", "quantity": 2}
    assert (await client.post("/api/stock-movements", headers=store, json=adjustment)).status_code == 422
    issued = await client.post(
        "/api/stock-movements",
        headers=store,
        json=movement
        | {
            "movement_type": "issue",
            "quantity": 2,
        },
    )
    assert float(issued.json()["quantity"]) == -2
    cycle_count = {"material_id": str(catalog.material.id), "counted_quantity": 7}
    counted = await client.post("/api/cycle-counts", headers=store, json=cycle_count)
    assert counted.status_code == 201 and float(counted.json()["quantity"]) == -1
    material = (await client.get(f"/api/materials/{catalog.material.id}", headers=store)).json()
    assert float(material["stock"]) == 7 and material["unit_cost"] is None and material["last_counted_at"]
    assert (await client.get("/api/materials", headers=manager)).json()[0]["unit_cost"] is not None

    quote = {
        "customer_id": str(catalog.customer.id),
        "part_id": str(catalog.part.id),
        "quantity": 4,
        "unit_price": 25,
    }
    assert (await client.post("/api/quotations", headers=store, json=quote)).status_code == 403
    created = await client.post("/api/quotations", headers=sales, json=quote)
    assert created.status_code == 201, created.text
    url = f"/api/quotations/{created.json()['id']}"
    assert (await client.get(url, headers=store)).status_code == 403
    assert (await client.get(url, headers=manager)).status_code == 200
    assert (await client.get("/api/quotations", headers=manager)).status_code == 200
    assert (await client.patch(url, headers=manager, json={"quantity": 9})).status_code == 403
    changed = await client.patch(url, headers=sales, json={"quantity": 9})
    assert changed.status_code == 200 and int(float(changed.json()["quantity"])) == 9
    assert await db_session.scalar(select(AuditLog.id).where(AuditLog.action == "cycle_count"))
