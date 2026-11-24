async def test_login_and_me(client, users):
    response = await client.post(
        "/api/auth/login", json={"email": "Manager@Test.local", "password": "test-password"}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["role"] == "manager"


async def test_wrong_password_is_rejected(client, users):
    response = await client.post("/api/auth/login", json={"email": "manager@test.local", "password": "nope"})
    assert response.status_code == 401


async def test_missing_or_bad_token_is_rejected(client):
    assert (await client.get("/api/auth/me")).status_code == 401
    bad = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert bad.status_code == 401


async def test_only_admin_creates_users(client, auth_headers):
    body = {"name": "New", "email": "new@test.local", "role": "sales", "password": "pw"}
    assert (await client.post("/api/users", json=body, headers=auth_headers("manager"))).status_code == 403
    created = await client.post("/api/users", json=body, headers=auth_headers("admin"))
    assert created.status_code == 201
    duplicate = await client.post("/api/users", json=body, headers=auth_headers("admin"))
    assert duplicate.status_code == 409


async def test_master_data_roles_and_audit(client, auth_headers, db_session):
    from sqlalchemy import select

    from app.models import AuditLog

    body = {"code": "NEW", "name": "New Customer"}
    assert (await client.post("/api/customers", json=body, headers=auth_headers("store"))).status_code == 403
    created = await client.post("/api/customers", json=body, headers=auth_headers("planner"))
    assert created.status_code == 201
    listing = await client.get("/api/customers", headers=auth_headers("store"))
    assert [row["code"] for row in listing.json()] == ["NEW"]
    actions = (await db_session.scalars(select(AuditLog.action).where(AuditLog.entity == "customers"))).all()
    assert actions == ["create"]


async def test_part_routing_and_bom(client, auth_headers):
    headers = auth_headers("planner")
    material = (await client.post("/api/suppliers", json={"name": "S"}, headers=headers)).json()
    assert material["name"] == "S"
    part = (
        await client.post("/api/parts", json={"part_number": "P-1", "revision": "A"}, headers=headers)
    ).json()
    steps = [
        {"step_number": 10, "machine_type": "cnc_lathe", "cycle_seconds_per_part": "60"},
        {"step_number": 10, "machine_type": "qc_station", "cycle_seconds_per_part": "10"},
    ]
    duplicate = await client.post(f"/api/parts/{part['id']}/routing", json=steps, headers=headers)
    assert duplicate.status_code == 422
    steps[1]["step_number"] = 20
    saved = await client.post(f"/api/parts/{part['id']}/routing", json=steps, headers=headers)
    assert [step["step_number"] for step in saved.json()] == [10, 20]


async def test_shift_validation(client, auth_headers):
    headers = auth_headers("planner")
    bad_day = {"name": "x", "weekday": 7, "start_time": "08:00", "end_time": "17:00"}
    assert (await client.post("/api/shifts", json=bad_day, headers=headers)).status_code == 422
    bad_time = {"name": "x", "weekday": 1, "start_time": "8am", "end_time": "17:00"}
    assert (await client.post("/api/shifts", json=bad_time, headers=headers)).status_code == 422
    good = {"name": "Day", "weekday": 1, "start_time": "08:00", "end_time": "17:00"}
    created = await client.post("/api/shifts", json=good, headers=headers)
    assert created.json()["start_time"] == "08:00"


async def test_settings_admin_only_and_validated(client, auth_headers):
    read = await client.get("/api/settings", headers=auth_headers("sales"))
    assert read.json()["values"]["hold_expiry_hours"] == 48
    patch = {"values": {"hold_expiry_hours": 24}}
    assert (
        await client.patch("/api/settings", json=patch, headers=auth_headers("manager"))
    ).status_code == 403
    updated = await client.patch("/api/settings", json=patch, headers=auth_headers("admin"))
    assert updated.json()["values"]["hold_expiry_hours"] == 24
    unknown = await client.patch(
        "/api/settings", json={"values": {"jwt_secret": 1}}, headers=auth_headers("admin")
    )
    assert unknown.status_code == 422
    negative = await client.patch(
        "/api/settings", json={"values": {"qc_buffer_hours": -1}}, headers=auth_headers("admin")
    )
    assert negative.status_code == 422


async def test_token_in_query_works_for_file_links(client, auth_headers):
    token = auth_headers("sales")["Authorization"].split(" ", 1)[1]
    assert (await client.get(f"/api/auth/me?token={token}")).status_code == 200
