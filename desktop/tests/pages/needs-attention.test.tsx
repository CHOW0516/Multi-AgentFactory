import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../src/pages/dashboards/mocks";
import { NeedsAttention } from "../../src/pages/dashboards/NeedsAttention";
import { logInAs, renderPage } from "./helpers";

vi.mock("../../src/api/client", async (importOriginal) => (await import("./mock-api")).mockedClient(importOriginal));

describe("needs attention", () => {
  it("lists the urgent items first, each with a button to act", async () => {
    logInAs("manager");
    renderPage(<NeedsAttention />);
    const panel = screen.getByTestId("needs-attention");
    expect(await within(panel).findByText("LATHE-02 is down")).toBeTruthy();
    const items = within(panel).getAllByRole("listitem");
    expect(within(items[0]).getByText("Urgent")).toBeTruthy();
    expect(within(items[0]).getByRole("link", { name: "Open floor" }).getAttribute("href")).toBe("/");
  });
});
