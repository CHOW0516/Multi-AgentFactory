import { describe, expect, it } from "vitest";
import type { Role } from "../../src/api/types";
import { orders, qcPlans } from "../../src/components/mock-data";
import { chartRows } from "../../src/pages/dashboards/ChartCard";
import { changedKeys, historyQueryString } from "../../src/pages/history/HistoryPage";
import { missingChecks } from "../../src/pages/quality/QualityPage";
import { discoverRoutes, sidebarRoutes } from "../../src/shell/routes";

describe("sidebar by role", () => {
  const routes = discoverRoutes();
  // P5 owns these two pages; leave them out so this test checks only P4's pages.
  const p5Labels = ["Factory floor", "Agent map"];
  const labelsFor = (role: Role) =>
    sidebarRoutes(routes, role).map((route) => route.label).filter((label) => !p5Labels.includes(label));

  it("store sees only materials and qc only quality", () => {
    expect(labelsFor("store")).toEqual(["Materials"]);
    expect(labelsFor("qc")).toEqual(["Quality"]);
  });
  it("sales sees orders and quotations, not approvals or settings", () => {
    expect(labelsFor("sales")).toEqual(["Orders", "Quotations"]);
  });
  it("manager sees approvals first and no settings; admin sees settings", () => {
    expect(labelsFor("manager")[0]).toBe("Approvals");
    expect(labelsFor("manager")).not.toContain("Settings");
    expect(labelsFor("admin")).toContain("Settings");
  });
  it("detail pages and login never show in the sidebar", () => {
    expect(labelsFor("admin")).not.toContain("Order");
    expect(labelsFor("admin")).not.toContain("Log in");
  });
});

describe("dashboard charts", () => {
  it("joins series into one row per label", () => {
    expect(chartRows({ name: "x", series: [
      { name: "Planned", points: [["CNC-01", 5], ["CNC-02", 3]] },
      { name: "Actual", points: [["CNC-01", 6]] },
    ] })).toEqual([{ label: "CNC-01", Planned: 5, Actual: 6 }, { label: "CNC-02", Planned: 3 }]);
  });
});

describe("history", () => {
  it("finds changed keys", () => {
    expect(changedKeys({ status: "A", due: "1" }, { status: "B", due: "1" })).toEqual(["status"]);
    expect(changedKeys(null, { status: "B" })).toEqual(["status"]);
  });
  it("only sends filters that are set", () => {
    expect(historyQueryString({ actor: " planning ", entity: "", from: "", to: "", text: "" }, 2)).toBe("page=2&page_size=50&actor=planning");
  });
});

describe("quality alerts", () => {
  const order = orders.find((candidate) => qcPlans[candidate.id] && candidate.status === "IN_PRODUCTION");
  it("flags a missing first-piece check while in production", () => {
    if (!order) throw new Error("mock data needs an order in production with a QC plan");
    const missing = missingChecks(order, { plan: qcPlans[order.id], records: [] });
    expect(missing.map((check) => check.kind)).toEqual(["first_piece"]);
  });
  it("flags the final check only once the order is completed", () => {
    if (!order) throw new Error("mock data needs an order in production with a QC plan");
    const plan = qcPlans[order.id];
    const firstPieceDone = [{ id: "r", order_id: order.id, check_name: plan.checks[0].name, result: "pass" as const, measured_value: null, inspector_id: null, note: null, created_at: "" }];
    expect(missingChecks(order, { plan, records: firstPieceDone })).toEqual([]);
    expect(missingChecks({ ...order, status: "COMPLETED" }, { plan, records: firstPieceDone }).map((check) => check.kind)).toEqual(["final"]);
  });
});
