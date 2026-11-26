import { describe, expect, it } from "vitest";
import {
  canLink, formatDuration, formatSimTime, normalizeMachineType, queueAt, simulate, stateAt, unreachableBlocks,
  validateDesign, type LineBlock, type LineDesign, type LineJob,
} from "../../src/pages/line-simulator/engine";

function block(id: string, kind: LineBlock["kind"], overrides: Partial<LineBlock> = {}): LineBlock {
  return {
    id, kind, name: id, machineType: kind === "machine" ? "other" : "", x: 0, y: 0,
    cycleSeconds: 60, setupMinutes: 0, scrapPercent: 0, breakdownsPerDay: 0, repairMinutes: 0, ...overrides,
  };
}

function job(id: string, quantity: number, overrides: Partial<LineJob> = {}): LineJob {
  return { id, name: id, quantity, startHour: 0, dueHour: 24, ...overrides };
}

/** Material in -> A -> B -> Ship out */
function straightLine(machineA: Partial<LineBlock> = {}, machineB: Partial<LineBlock> = {}, jobs = [job("J1", 10)]): LineDesign {
  return {
    blocks: [block("in", "source"), block("A", "machine", machineA), block("B", "machine", machineB), block("out", "sink")],
    links: [{ id: "l1", from: "in", to: "A" }, { id: "l2", from: "A", to: "B" }, { id: "l3", from: "B", to: "out" }],
    jobs,
  };
}

describe("validateDesign", () => {
  it("accepts a straight line", () => {
    expect(validateDesign(straightLine())).toEqual([]);
  });

  it("needs one Material in, a Ship out and a job", () => {
    const messages = validateDesign({ blocks: [block("A", "machine")], links: [], jobs: [] }).map((problem) => problem.message);
    expect(messages).toContain("Add exactly one Material in block.");
    expect(messages).toContain("Add at least one Ship out block.");
    expect(messages).toContain("Add at least one job.");
    expect(messages).toContain("A has no outgoing link.");
  });

  it("rejects two Material in blocks", () => {
    const design = straightLine();
    design.blocks.push(block("in2", "source"));
    design.links.push({ id: "l4", from: "in2", to: "A" });
    expect(validateDesign(design).map((problem) => problem.message)).toContain("Add exactly one Material in block.");
  });

  it("rejects a zero cycle time, a bad quantity and too many parts", () => {
    const messages = validateDesign(straightLine({ cycleSeconds: 0 }, {}, [job("J1", 0), job("J2", 25_000)]))
      .map((problem) => problem.message);
    expect(messages).toContain("A needs a cycle time above 0.");
    expect(messages).toContain("Job J1 needs a quantity of 1 or more.");
    expect(messages.some((message) => message.startsWith("Too many parts"))).toBe(true);
  });

  it("rejects a loop", () => {
    const design = straightLine();
    design.links.push({ id: "back", from: "B", to: "A" });
    expect(validateDesign(design).map((problem) => problem.message)).toContain("The line has a loop. Parts must always move forward.");
  });
});

describe("canLink", () => {
  it("blocks self links, duplicates, loops and wrong directions", () => {
    const design = straightLine();
    expect(canLink(design, "A", "A")).toBe(false);
    expect(canLink(design, "A", "B")).toBe(false);
    expect(canLink(design, "B", "A")).toBe(false);
    expect(canLink(design, "out", "A")).toBe(false);
    expect(canLink(design, "A", "in")).toBe(false);
    expect(canLink(design, "A", "out")).toBe(true);
  });
});

describe("unreachableBlocks", () => {
  it("lists machines no part can reach", () => {
    const design = straightLine();
    design.blocks.push(block("C", "machine"));
    design.links.push({ id: "l5", from: "C", to: "out" });
    expect(unreachableBlocks(design).map((item) => item.id)).toEqual(["C"]);
  });
});

describe("simulate", () => {
  it("runs a straight line: the slowest machine sets the pace", () => {
    // A takes 60 s, B takes 120 s. 10 parts: first part leaves A at 60 s, B then needs 10 x 120 s.
    const result = simulate(straightLine({ cycleSeconds: 60 }, { cycleSeconds: 120 }));
    expect(result.finished).toBe(true);
    expect(result.goodParts).toBe(10);
    expect(result.endSeconds).toBe(60 + 10 * 120);
    expect(result.bottleneckId).toBe("B");
    const machineB = result.machines.find((machine) => machine.blockId === "B");
    expect(machineB?.partsMade).toBe(10);
    expect(machineB?.busyPercent).toBeCloseTo(1200 / 1260 * 100, 0);
    expect(result.jobs[0].finishSeconds).toBe(1260);
    expect(result.jobs[0].late).toBe(false);
  });

  it("adds setup time once per job and again when the job changes", () => {
    const result = simulate(straightLine({ cycleSeconds: 60, setupMinutes: 10 }, { cycleSeconds: 1 },
      [job("J1", 2), job("J2", 2)]));
    // A: setup 600 + 2 x 60, setup 600 + 2 x 60 = 1440; then B adds 1 s for the last part.
    expect(result.endSeconds).toBe(1441);
    const machineA = result.machines.find((machine) => machine.blockId === "A");
    expect(machineA?.periods.filter((period) => period.state === "setup")).toHaveLength(2);
  });

  it("splits parts across two parallel machines", () => {
    const design: LineDesign = {
      blocks: [block("in", "source"), block("M1", "machine"), block("M2", "machine"), block("out", "sink")],
      links: [
        { id: "a", from: "in", to: "M1" }, { id: "b", from: "in", to: "M2" },
        { id: "c", from: "M1", to: "out" }, { id: "d", from: "M2", to: "out" },
      ],
      jobs: [job("J1", 10)],
    };
    const result = simulate(design);
    expect(result.machines.map((machine) => machine.partsMade)).toEqual([5, 5]);
    expect(result.endSeconds).toBe(5 * 60);
  });

  it("removes scrapped parts and is the same every run", () => {
    const design = straightLine({ scrapPercent: 50 }, {}, [job("J1", 200)]);
    const first = simulate(design);
    const second = simulate(design);
    expect(first.scrappedParts).toBeGreaterThan(50);
    expect(first.scrappedParts).toBeLessThan(150);
    expect(first.goodParts + first.scrappedParts).toBe(200);
    expect(second.scrappedParts).toBe(first.scrappedParts);
    expect(first.jobs[0].finishSeconds).not.toBeNull();
  });

  it("breakdowns make the line slower and show as down time", () => {
    const normal = simulate(straightLine({}, {}, [job("J1", 500, { dueHour: 1000 })]));
    const broken = simulate(straightLine({ breakdownsPerDay: 12, repairMinutes: 60 }, {}, [job("J1", 500, { dueHour: 1000 })]));
    expect(broken.endSeconds).toBeGreaterThan(normal.endSeconds);
    expect(broken.machines[0].downPercent).toBeGreaterThan(0);
    expect(broken.goodParts).toBe(500);
  });

  it("marks late jobs and respects job start times", () => {
    const result = simulate(straightLine({}, {}, [job("J1", 100, { dueHour: 1 }), job("J2", 1, { startHour: 48, dueHour: 49 })]));
    expect(result.jobs[0].late).toBe(true);
    expect(result.jobs[1].late).toBe(false);
    expect(result.jobs[1].finishSeconds).toBe(48 * 3600 + 120);
  });

  it("records moves and states for playback", () => {
    const result = simulate(straightLine({}, {}, [job("J1", 3)]));
    expect(result.moves.filter((move) => move.to === "out")).toHaveLength(3);
    const machineA = result.machines[0];
    expect(stateAt(machineA.periods, 30)).toBe("running");
    expect(stateAt(machineA.periods, result.endSeconds + 10)).toBe("idle");
    expect(queueAt(machineA.queueChanges, 0)).toBe(2); // 3 parts arrive, 1 starts, 2 wait
    expect(queueAt(machineA.queueChanges, 200)).toBe(0);
    const machineB = result.machines[1];
    expect(stateAt(machineB.periods, 30)).toBe("idle");
  });
});

describe("helpers", () => {
  it("normalizes typed machine types", () => {
    expect(normalizeMachineType("qc-station")).toBe("qc_station");
    expect(normalizeMachineType(" CNC Lathe ")).toBe("cnc_lathe");
    expect(normalizeMachineType("welder")).toBe("other");
  });

  it("formats times", () => {
    expect(formatSimTime(0)).toBe("Day 1, 00:00");
    expect(formatSimTime(86_400 + 6.5 * 3600)).toBe("Day 2, 06:30");
    expect(formatDuration(90_061)).toBe("1d 1h 1m");
    expect(formatDuration(30)).toBe("0m");
  });
});
