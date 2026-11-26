import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfidenceText, confidenceLevel } from "../../src/components/DeliveryConfidence";

describe("delivery confidence", () => {
  it("shows the chance and both dates", () => {
    render(<ConfidenceText confidence={{ chance_on_time: 85, likely_date: "2026-12-11", safe_date: "2026-12-14", runs: 200 }} />);
    const text = screen.getByTestId("delivery-confidence").textContent ?? "";
    expect(text).toContain("85% on time");
    expect(text).toContain("200 runs");
  });
  it("leaves out the chance when the order has no due date", () => {
    render(<ConfidenceText confidence={{ chance_on_time: null, likely_date: "2026-12-11", safe_date: "2026-12-14", runs: 200 }} />);
    expect(screen.getByTestId("delivery-confidence").textContent).not.toContain("on time");
  });
  it("grades the chance", () => {
    expect([confidenceLevel(90), confidenceLevel(60), confidenceLevel(20), confidenceLevel(null)]).toEqual(["good", "fair", "poor", null]);
  });
});
