import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { materials } from "../../src/components/mock-data";
import { MaterialsPage } from "../../src/pages/materials/MaterialsPage";
import { signedQuantity, validateMovement, type MovementDraft } from "../../src/pages/materials/movement-rules";
import { MovementForm } from "../../src/pages/materials/MovementForm";
import { logInAs, renderPage } from "./helpers";

vi.mock("../../src/api/client", async (importOriginal) => (await import("./mock-api")).mockedClient(importOriginal));

const draft = (change: Partial<MovementDraft>): MovementDraft => ({
  materialCode: materials[0].code, movementType: "issue", quantity: "10", adjustDirection: "add", reference: "", reason: "", ...change,
});

describe("stock movement rules", () => {
  it("accepts a normal issue", () => {
    expect(validateMovement(draft({}), materials)).toEqual({});
  });
  it("rejects unknown codes, zero or text quantities, and over-issuing", () => {
    expect(validateMovement(draft({ materialCode: "NOPE" }), materials).materialCode).toBeTruthy();
    expect(validateMovement(draft({ quantity: "0" }), materials).quantity).toBeTruthy();
    expect(validateMovement(draft({ quantity: "abc" }), materials).quantity).toBeTruthy();
    expect(validateMovement(draft({ quantity: String(Number(materials[0].stock) + 1) }), materials).quantity).toMatch(/Only/);
  });
  it("needs a reason for scrap and adjust, and a reference for receive", () => {
    expect(validateMovement(draft({ movementType: "scrap" }), materials).reason).toBeTruthy();
    expect(validateMovement(draft({ movementType: "adjust" }), materials).reason).toBeTruthy();
    expect(validateMovement(draft({ movementType: "receive" }), materials).reference).toBeTruthy();
  });
  it("matches codes without caring about case (barcode scanners)", () => {
    expect(validateMovement(draft({ materialCode: materials[0].code.toLowerCase() }), materials)).toEqual({});
  });
  it("signs quantities by movement type", () => {
    expect(signedQuantity(draft({ movementType: "receive" }))).toBe(10);
    expect(signedQuantity(draft({ movementType: "issue" }))).toBe(-10);
    expect(signedQuantity(draft({ movementType: "adjust", adjustDirection: "remove" }))).toBe(-10);
  });
});

describe("movement form", () => {
  it("shows problems and does not save an empty form", async () => {
    logInAs("store");
    renderPage(<MovementForm materials={materials} />);
    await userEvent.click(screen.getByRole("button", { name: "Save movement" }));
    expect(screen.getByText("Scan or type a material code.")).toBeInTheDocument();
    expect(screen.getByText("Enter a number.")).toBeInTheDocument();
  });

  it("Enter in the code field (scanner) moves to quantity", async () => {
    logInAs("store");
    renderPage(<MovementForm materials={materials} />);
    await userEvent.type(screen.getByLabelText("Material code"), `${materials[0].code}{Enter}`);
    expect(screen.getByLabelText(/Quantity/)).toHaveFocus();
  });
});

describe("prices by role", () => {
  it("store staff see no unit cost", async () => {
    logInAs("store");
    renderPage(<MaterialsPage />);
    await waitFor(() => expect(screen.getByText(materials[0].code)).toBeInTheDocument());
    expect(screen.queryByText("Unit cost")).not.toBeInTheDocument();
    expect(screen.queryByText(/MYR/)).not.toBeInTheDocument();
  });

  it("managers see the unit cost", async () => {
    logInAs("manager");
    renderPage(<MaterialsPage />);
    await waitFor(() => expect(screen.getByText("Unit cost")).toBeInTheDocument());
    expect(screen.getAllByText(/MYR/).length).toBeGreaterThan(0);
  });
});
