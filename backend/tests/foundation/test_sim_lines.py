"""Saved lines for the machine line simulator."""

DESIGN = {
    "blocks": [
        {"id": "in", "kind": "source", "name": "Material in", "machineType": "", "x": 40, "y": 200,
         "cycleSeconds": 0, "setupMinutes": 0, "scrapPercent": 0, "breakdownsPerDay": 0, "repairMinutes": 0},
        {"id": "m1", "kind": "machine", "name": "Lathe 1", "machineType": "cnc_lathe", "x": 240, "y": 200,
         "cycleSeconds": 90, "setupMinutes": 30, "scrapPercent": 1, "breakdownsPerDay": 0.5, "repairMinutes": 60},
        {"id": "out", "kind": "sink", "name": "Ship out", "machineType": "", "x": 440, "y": 200,
         "cycleSeconds": 0, "setupMinutes": 0, "scrapPercent": 0, "breakdownsPerDay": 0, "repairMinutes": 0},
    ],
    "links": [{"id": "l1", "from": "in", "to": "m1"}, {"id": "l2", "from": "m1", "to": "out"}],
    "jobs": [{"id": "j1", "name": "Job 1", "quantity": 100, "startHour": 0, "dueHour": 24}],
}


async def test_line_create_read_update_delete(client, auth_headers):
    headers = auth_headers("planner")
    created = await client.post("/api/sim-lines", json={"name": " Line A ", "design": DESIGN}, headers=headers)
    assert created.status_code == 201
    line = created.json()
    assert line["name"] == "Line A"
    assert line["design"] == DESIGN  # "from" keeps its name in and out

    listing = (await client.get("/api/sim-lines", headers=auth_headers("manager"))).json()
    assert [row["name"] for row in listing] == ["Line A"]
    assert "design" not in listing[0]

    changed = {**DESIGN, "jobs": [{**DESIGN["jobs"][0], "quantity": 5}]}
    updated = await client.put(f"/api/sim-lines/{line['id']}", json={"name": "Line B", "design": changed}, headers=headers)
    assert updated.status_code == 200
    read = (await client.get(f"/api/sim-lines/{line['id']}", headers=headers)).json()
    assert read["name"] == "Line B"
    assert read["design"]["jobs"][0]["quantity"] == 5

    assert (await client.delete(f"/api/sim-lines/{line['id']}", headers=headers)).status_code == 204
    assert (await client.get(f"/api/sim-lines/{line['id']}", headers=headers)).status_code == 404


async def test_line_roles(client, auth_headers):
    body = {"name": "Line", "design": DESIGN}
    for role in ("sales", "store", "qc"):
        assert (await client.get("/api/sim-lines", headers=auth_headers(role))).status_code == 403
        assert (await client.post("/api/sim-lines", json=body, headers=auth_headers(role))).status_code == 403
    assert (await client.post("/api/sim-lines", json=body, headers=auth_headers("admin"))).status_code == 201


async def test_line_design_is_checked(client, auth_headers):
    headers = auth_headers("manager")
    bad_kind = {**DESIGN, "blocks": [{**DESIGN["blocks"][0], "kind": "robot"}]}
    assert (await client.post("/api/sim-lines", json={"name": "X", "design": bad_kind}, headers=headers)).status_code == 422
    bad_quantity = {**DESIGN, "jobs": [{**DESIGN["jobs"][0], "quantity": 0}]}
    assert (await client.post("/api/sim-lines", json={"name": "X", "design": bad_quantity}, headers=headers)).status_code == 422
    assert (await client.post("/api/sim-lines", json={"name": "", "design": DESIGN}, headers=headers)).status_code == 422
    missing = "/api/sim-lines/00000000-0000-0000-0000-000000000000"
    assert (await client.put(missing, json={"name": "X", "design": DESIGN}, headers=headers)).status_code == 404
