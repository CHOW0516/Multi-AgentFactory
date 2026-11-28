import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useRef } from "react";
import { useFloorCamera } from "../../src/pages/factory-floor/use-floor-camera";
import { iso } from "../../src/iso/iso-kit";
import { floorArt } from "../../src/figures/floor-geometry";
import { createMapArt } from "../../src/figures/agent-geometry";
import { floorProjection, initialView, inspectorOffset, locateInView } from "../../src/pages/factory-floor/floor-camera";

describe("floating scene inspection", () => {
  it.each([
    { width: 1240, height: 720, panel: new DOMRect(910, 24, 306, 480), header: 120 },
    { width: 390, height: 844, panel: new DOMRect(12, 480, 366, 352), header: 160 },
  ])("focuses clear of the panel at $width pixels without changing the viewport", ({ width, height, panel, header }) => {
    const workspace = document.createElement("section");
    workspace.className = "floor-workspace";
    workspace.innerHTML = '<svg></svg><header class="floor-overview"></header><section class="floor-inspector"></section>';
    const scene = workspace.querySelector("svg")!;
    vi.spyOn(scene, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, height));
    vi.spyOn(workspace.querySelector(".floor-overview")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, header));
    vi.spyOn(workspace.querySelector(".floor-inspector")!, "getBoundingClientRect").mockReturnValue(panel);
    const camera = floorProjection(53, 38);
    const point: [number, number, number] = [800, 400, 60];
    const view = locateInView(initialView, point, camera, inspectorOffset(scene));
    const [x, y] = iso(point, camera);
    const scale = Math.min(width / 1240, height / 720);
    const screenX = width / 2 + ((x - 620) * view.zoom + view.x) * scale;
    const screenY = height / 2 + ((y - 367) * view.zoom + view.y + 7) * scale;
    if (width > 760) {
      expect(screenX).toBeGreaterThan(100);
      expect(screenX).toBeLessThan(panel.left - 100);
    } else {
      expect(screenY).toBeGreaterThan(header + 30);
      expect(screenY).toBeLessThan(panel.top - 30);
    }
    expect(scene.getBoundingClientRect().width).toBe(width);
  });
});

describe("camera movement geometry", () => {
  it("uses motion detail throughout a wheel burst and restores detail when it settles", () => {
    vi.useFakeTimers();
    function Probe() {
      const scene = useRef<SVGSVGElement>(null);
      const camera = useFloorCamera(scene);
      return createElement("svg", { ref: scene, "aria-label": "camera", "data-detail": camera.lowDetail ? "motion" : "full" });
    }
    try {
      const { unmount } = render(createElement(Probe));
      const scene = screen.getByLabelText("camera");
      fireEvent.wheel(scene, { deltaY: -10 });
      expect(scene).toHaveAttribute("data-detail", "motion");
      act(() => vi.advanceTimersByTime(100));
      fireEvent.wheel(scene, { deltaY: -10 });
      act(() => vi.advanceTimersByTime(100));
      expect(scene).toHaveAttribute("data-detail", "motion");
      act(() => vi.advanceTimersByTime(150));
      expect(scene).toHaveAttribute("data-detail", "full");
      fireEvent.wheel(scene, { deltaY: -10 });
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reduces fine floor detail while preserving full detail for the settled view", () => {
    const camera = floorProjection(53, 38);
    const full = floorArt(camera).machineArt.cnc_lathe.body;
    const motion = floorArt(camera, "motion").machineArt.cnc_lathe.body;
    expect(full).toContain("iso-bevel");
    expect(motion).not.toContain("iso-bevel");
    expect(motion.length).toBeLessThan(full.length / 2);
    expect(floorArt(camera).machineArt.cnc_lathe.body).toBe(full);
  });

  it("keeps every agent and traffic route while reducing conveyor detail", () => {
    const camera = floorProjection(53, 38);
    const full = createMapArt(camera);
    const motion = createMapArt(camera, "motion");
    expect(Object.keys(motion.stationArt)).toEqual(Object.keys(full.stationArt));
    expect(motion.ringArt.length).toBeLessThan(full.ringArt.length / 2);
    for (const name of Object.keys(full.railArt) as (keyof typeof full.railArt)[]) {
      expect(motion.railArt[name].sample(.5)).toEqual(full.railArt[name].sample(.5));
    }
  });
});
