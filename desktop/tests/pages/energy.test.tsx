import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanOptionOut } from "../../src/api/types";
import { appSettings, machines } from "../../src/components/mock-data";
import { PlanOptionCards } from "../../src/pages/approval-detail/PlanOptionCards";
import { SettingsPage } from "../../src/pages/settings/SettingsPage";
import { logInAs, renderPage } from "./helpers";

vi.mock("../../src/api/client", async (importOriginal) => (await import("./mock-api")).mockedClient(importOriginal));

const option = (change: Partial<PlanOptionOut>): PlanOptionOut => ({
  id: "o1", option_type: "cheaper_energy", finish_date: "2027-01-06", split_quantity_first: null, split_finish_date_first: null,
  overtime_hours: "0", extra_cost: "0", energy_kwh: "40", energy_cost: "20.00", margin: null, machine_load: null,
  impacted_orders: [], explanation: null, is_recommended: true, status: "proposed", ...change,
});

describe("energy on plan options", () => {
  it("shows the cheaper energy option with its electricity cost", () => {
    logInAs("manager");
    renderPage(<PlanOptionCards options={[option({})]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Cheaper energy" })).toBeInTheDocument();
    expect(screen.getByText("Electricity")).toBeInTheDocument();
    expect(screen.getByText(/40 kWh/)).toBeInTheDocument();
  });
  it("hides the electricity row when energy is not tracked", () => {
    logInAs("manager");
    renderPage(<PlanOptionCards options={[option({ option_type: "delay", energy_kwh: null, energy_cost: null })]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.queryByText("Electricity")).not.toBeInTheDocument();
  });
});

describe("energy settings", () => {
  it("saves peak times and rates and marks them as the factory's own", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Energy" }));
    expect(await screen.findByText(/These are demo values/)).toBeInTheDocument();
    const peakRate = screen.getByLabelText(/Peak rate/);
    await userEvent.clear(peakRate);
    await userEvent.type(peakRate, "0.62");
    await userEvent.click(screen.getByLabelText(/Saturday and Sunday/));
    await userEvent.click(screen.getByRole("button", { name: "Save energy settings" }));
    await waitFor(() => expect(appSettings.values.energy_peak_rate).toBe(0.62));
    expect(appSettings.values.energy_peak_weekends).toBe(1);
    expect(appSettings.values.energy_rates_confirmed).toBe(1);
    expect(appSettings.values.energy_peak_start_minute).toBe(840);
  });
  it("blocks a negative rate", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Energy" }));
    const offpeak = await screen.findByLabelText(/Off-peak rate/);
    await userEvent.clear(offpeak);
    await userEvent.type(offpeak, "-1");
    expect(screen.getByRole("button", { name: "Save energy settings" })).toBeDisabled();
  });
  it("keeps energy keys off the business rules tab", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Business rules" }));
    await screen.findByRole("button", { name: "Save rules" });
    expect(screen.queryByLabelText(/Energy peak rate/)).not.toBeInTheDocument();
  });
  it("edits a machine's power use", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Machines" }));
    const machine = machines[0];
    const form = await screen.findByRole("form", { name: `${machine.code} power use` });
    const running = within(form).getByLabelText(`${machine.code} running kW`);
    await userEvent.clear(running);
    await userEvent.type(running, "22");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(machines[0].running_kw).toBe("22"));
  });
});

describe("energy alerts settings", () => {
  it("saves the waste alert limits", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Energy" }));
    const idle = await screen.findByLabelText(/Idle but switched on for/);
    await userEvent.clear(idle);
    await userEvent.type(idle, "45");
    await userEvent.click(screen.getByRole("button", { name: "Save energy settings" }));
    await waitFor(() => expect(appSettings.values.energy_idle_alert_minutes).toBe(45));
  });
  it("blocks an abnormal limit of 0%", async () => {
    logInAs("admin");
    renderPage(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Energy" }));
    const percent = await screen.findByLabelText(/Power above normal by/);
    await userEvent.clear(percent);
    await userEvent.type(percent, "0");
    expect(screen.getByRole("button", { name: "Save energy settings" })).toBeDisabled();
  });
});
