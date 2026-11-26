// Machine line simulator: the design a user draws and the simulation that runs it.
// Runs fully in the browser. No AI calls, no server calls.
//
// Rules (kept simple on purpose):
// - Parts start at the single "Material in" block and end at a "Ship out" block.
// - Each machine works one part at a time and has an unlimited first-in-first-out queue.
// - Setup time is added before the first part of each job (and when the job changes).
// - When a block has several outgoing links, the part goes to the next block with the shortest queue.
// - Scrapped parts leave the line at that machine.
// - Breakdowns happen at random (seeded, so the same design gives the same result).
// - Machines run 24 hours a day.

export type BlockKind = "source" | "machine" | "sink";

export interface LineBlock {
  id: string;
  kind: BlockKind;
  name: string;
  machineType: string;       // "" for source and sink
  x: number;
  y: number;
  cycleSeconds: number;      // per part
  setupMinutes: number;      // before each new job
  scrapPercent: number;      // 0..100
  breakdownsPerDay: number;  // average, 0 = never
  repairMinutes: number;     // per breakdown
}

export interface LineLink { id: string; from: string; to: string }

export interface LineJob {
  id: string;
  name: string;
  quantity: number;
  startHour: number;  // hours after the simulation starts
  dueHour: number;    // hours after the simulation starts
}

export interface LineDesign { blocks: LineBlock[]; links: LineLink[]; jobs: LineJob[] }

export interface MachineTypeInfo {
  type: string; label: string; cycleSeconds: number; setupMinutes: number;
}

export const MACHINE_TYPES: MachineTypeInfo[] = [
  { type: "cnc_lathe", label: "CNC lathe", cycleSeconds: 90, setupMinutes: 30 },
  { type: "cnc_mill", label: "CNC mill", cycleSeconds: 180, setupMinutes: 45 },
  { type: "laser_cutter", label: "Laser cutter", cycleSeconds: 60, setupMinutes: 15 },
  { type: "press_brake", label: "Press brake", cycleSeconds: 45, setupMinutes: 20 },
  { type: "qc_station", label: "QC station", cycleSeconds: 30, setupMinutes: 0 },
  { type: "packing", label: "Packing", cycleSeconds: 20, setupMinutes: 0 },
  { type: "other", label: "Other machine", cycleSeconds: 60, setupMinutes: 10 },
];

export const MAX_TOTAL_PARTS = 20_000;
export const MAX_SIM_DAYS = 365;
const SECONDS_PER_DAY = 86_400;

/** Map a machine type typed by hand ("QC-Station", "qc station") to a known type, or "other". */
export function normalizeMachineType(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MACHINE_TYPES.some((info) => info.type === cleaned) ? cleaned : "other";
}

export function machineTypeInfo(type: string): MachineTypeInfo {
  return MACHINE_TYPES.find((info) => info.type === type) ?? MACHINE_TYPES[MACHINE_TYPES.length - 1];
}

// ---------------------------------------------------------------- validation

export interface DesignProblem { message: string; blockId?: string }

/** Problems that stop the line from running. Empty list = ready to run. */
export function validateDesign(design: LineDesign): DesignProblem[] {
  const problems: DesignProblem[] = [];
  const sources = design.blocks.filter((block) => block.kind === "source");
  const sinks = design.blocks.filter((block) => block.kind === "sink");
  if (sources.length !== 1) problems.push({ message: "Add exactly one Material in block." });
  if (sinks.length === 0) problems.push({ message: "Add at least one Ship out block." });

  const outgoing = linksFrom(design);
  for (const block of design.blocks) {
    if (block.kind !== "sink" && (outgoing.get(block.id) ?? []).length === 0) {
      problems.push({ message: `${block.name} has no outgoing link.`, blockId: block.id });
    }
    if (block.kind === "machine" && !(block.cycleSeconds > 0)) {
      problems.push({ message: `${block.name} needs a cycle time above 0.`, blockId: block.id });
    }
  }
  if (hasLoop(design, outgoing)) problems.push({ message: "The line has a loop. Parts must always move forward." });

  if (design.jobs.length === 0) problems.push({ message: "Add at least one job." });
  let totalParts = 0;
  for (const job of design.jobs) {
    if (!Number.isInteger(job.quantity) || job.quantity < 1) problems.push({ message: `Job ${job.name} needs a quantity of 1 or more.` });
    if (job.startHour < 0) problems.push({ message: `Job ${job.name} cannot start before hour 0.` });
    totalParts += Math.max(0, job.quantity);
  }
  if (totalParts > MAX_TOTAL_PARTS) {
    problems.push({ message: `Too many parts (${totalParts}). The limit is ${MAX_TOTAL_PARTS.toLocaleString()}.` });
  }
  return problems;
}

/** Blocks that parts can never reach from Material in. They are ignored when running. */
export function unreachableBlocks(design: LineDesign): LineBlock[] {
  const source = design.blocks.find((block) => block.kind === "source");
  const outgoing = linksFrom(design);
  const seen = new Set<string>();
  const pending = source ? [source.id] : [];
  while (pending.length) {
    const blockId = pending.pop() as string;
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    pending.push(...(outgoing.get(blockId) ?? []));
  }
  return design.blocks.filter((block) => !seen.has(block.id));
}

function linksFrom(design: LineDesign): Map<string, string[]> {
  const blockIds = new Set(design.blocks.map((block) => block.id));
  const outgoing = new Map<string, string[]>();
  for (const link of design.links) {
    if (!blockIds.has(link.from) || !blockIds.has(link.to)) continue;
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  }
  return outgoing;
}

function hasLoop(design: LineDesign, outgoing: Map<string, string[]>): boolean {
  const state = new Map<string, "visiting" | "done">();
  const visit = (blockId: string): boolean => {
    if (state.get(blockId) === "visiting") return true;
    if (state.get(blockId) === "done") return false;
    state.set(blockId, "visiting");
    for (const next of outgoing.get(blockId) ?? []) if (visit(next)) return true;
    state.set(blockId, "done");
    return false;
  };
  return design.blocks.some((block) => visit(block.id));
}

/** True when adding a link from -> to would be allowed (no self link, no duplicate, no loop, no link into Material in or out of Ship out). */
export function canLink(design: LineDesign, from: string, to: string): boolean {
  if (from === to) return false;
  const fromBlock = design.blocks.find((block) => block.id === from);
  const toBlock = design.blocks.find((block) => block.id === to);
  if (!fromBlock || !toBlock || fromBlock.kind === "sink" || toBlock.kind === "source") return false;
  if (design.links.some((link) => link.from === from && link.to === to)) return false;
  const withLink = { ...design, links: [...design.links, { id: "check", from, to }] };
  return !hasLoop(withLink, linksFrom(withLink));
}

// ---------------------------------------------------------------- simulation

export type MachineState = "idle" | "setup" | "running" | "down";

/** One period where a machine was in one state. Periods are in time order and do not overlap. */
export interface StatePeriod { start: number; end: number; state: MachineState }

/** A part moving from one block to the next (used to animate dots). */
export interface PartMove { time: number; from: string; to: string; jobIndex: number }

export interface MachineResult {
  blockId: string;
  name: string;
  partsMade: number;
  partsScrapped: number;
  busyPercent: number;   // running + setup
  setupPercent: number;
  downPercent: number;
  maxQueue: number;
  periods: StatePeriod[];
  queueChanges: { time: number; size: number }[];
}

export interface JobResult {
  jobId: string;
  name: string;
  quantity: number;
  good: number;
  scrapped: number;
  finishSeconds: number | null;  // null = not finished within the time limit
  dueSeconds: number;
  late: boolean;
}

export interface SimulationResult {
  finished: boolean;          // false when the time limit was reached
  endSeconds: number;         // when the last part left the line (or the time limit)
  goodParts: number;
  scrappedParts: number;
  partsPerHour: number;
  bottleneckId: string | null;
  machines: MachineResult[];
  jobs: JobResult[];
  moves: PartMove[];
}

interface Part { jobIndex: number }

interface MachineRun {
  block: LineBlock;
  queue: Part[];
  busy: boolean;
  incoming: number;   // parts sent here but not arrived yet (same moment)
  lastJobIndex: number | null;
  downtimes: { start: number; end: number }[];
  result: MachineResult;
}

interface SimEvent { time: number; order: number; kind: "arrive" | "finish"; blockId: string; part: Part }

/** Small min-heap of events ordered by time, then by the order they were added. */
class EventQueue {
  private items: SimEvent[] = [];
  private added = 0;
  get size() { return this.items.length; }
  push(event: Omit<SimEvent, "order">) {
    this.items.push({ ...event, order: this.added++ });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(this.items[index], this.items[parent])) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }
  pop(): SimEvent {
    const top = this.items[0];
    const last = this.items.pop() as SimEvent;
    if (this.items.length) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.before(this.items[left], this.items[smallest])) smallest = left;
        if (right < this.items.length && this.before(this.items[right], this.items[smallest])) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
    return top;
  }
  private before(first: SimEvent, second: SimEvent) {
    return first.time < second.time || (first.time === second.time && first.order < second.order);
  }
}

/** Seeded random numbers (mulberry32) so a design always gives the same result. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random breakdown periods for one machine, up to the time limit. */
function makeDowntimes(block: LineBlock, random: () => number, limit: number) {
  const downtimes: { start: number; end: number }[] = [];
  if (!(block.breakdownsPerDay > 0) || !(block.repairMinutes > 0)) return downtimes;
  const meanGap = SECONDS_PER_DAY / block.breakdownsPerDay;
  let time = 0;
  for (;;) {
    time += -Math.log(1 - random()) * meanGap;
    if (time >= limit) break;
    const end = time + block.repairMinutes * 60;
    downtimes.push({ start: time, end });
    time = end;
  }
  return downtimes;
}

/** Add `work` seconds of working time starting at `start`, skipping breakdowns. Returns the end time. */
function addWorkingTime(start: number, work: number, downtimes: { start: number; end: number }[]): number {
  let time = start;
  let left = work;
  for (const down of downtimes) {
    if (down.end <= time) continue;
    if (down.start >= time + left) break;
    if (down.start > time) { left -= down.start - time; }
    time = Math.max(time, down.end);
  }
  return time + left;
}

export function simulate(design: LineDesign, seed = 1): SimulationResult {
  const random = seededRandom(seed);
  const limit = MAX_SIM_DAYS * SECONDS_PER_DAY;
  const outgoing = linksFrom(design);
  const blocksById = new Map(design.blocks.map((block) => [block.id, block]));
  const source = design.blocks.find((block) => block.kind === "source");
  if (!source) throw new Error("The line has no Material in block.");

  const machines = new Map<string, MachineRun>();
  for (const block of design.blocks) {
    if (block.kind !== "machine") continue;
    machines.set(block.id, {
      block, queue: [], busy: false, incoming: 0, lastJobIndex: null,
      downtimes: makeDowntimes(block, random, limit),
      result: {
        blockId: block.id, name: block.name, partsMade: 0, partsScrapped: 0,
        busyPercent: 0, setupPercent: 0, downPercent: 0, maxQueue: 0, periods: [], queueChanges: [],
      },
    });
  }

  const jobs: JobResult[] = design.jobs.map((job) => ({
    jobId: job.id, name: job.name, quantity: job.quantity, good: 0, scrapped: 0,
    finishSeconds: null, dueSeconds: job.dueHour * 3600, late: false,
  }));
  const moves: PartMove[] = [];
  const events = new EventQueue();

  // Busy periods (setup/running) are recorded here; idle and down periods are filled in at the end.
  const busyPeriods = new Map<string, StatePeriod[]>();
  for (const id of machines.keys()) busyPeriods.set(id, []);

  design.jobs.forEach((job, jobIndex) => {
    for (let count = 0; count < job.quantity; count++) {
      events.push({ time: job.startHour * 3600, kind: "arrive", blockId: source.id, part: { jobIndex } });
    }
  });

  const queueSize = (blockId: string) => {
    const machine = machines.get(blockId);
    return machine ? machine.queue.length + machine.incoming + (machine.busy ? 1 : 0) : 0;
  };

  const sendOn = (time: number, fromId: string, part: Part) => {
    const nextIds = outgoing.get(fromId) ?? [];
    let best = nextIds[0];
    for (const nextId of nextIds) if (queueSize(nextId) < queueSize(best)) best = nextId;
    const nextMachine = machines.get(best);
    if (nextMachine) nextMachine.incoming++;
    moves.push({ time, from: fromId, to: best, jobIndex: part.jobIndex });
    events.push({ time, kind: "arrive", blockId: best, part });
  };

  const partDone = (time: number, part: Part) => {
    const job = jobs[part.jobIndex];
    if (job.good + job.scrapped === job.quantity) job.finishSeconds = time;
  };

  const startNext = (time: number, machine: MachineRun) => {
    if (machine.busy || machine.queue.length === 0) return;
    const part = machine.queue.shift() as Part;
    machine.result.queueChanges.push({ time, size: machine.queue.length });
    machine.busy = true;
    const periods = busyPeriods.get(machine.block.id) as StatePeriod[];
    let workStart = time;
    if (machine.lastJobIndex !== part.jobIndex && machine.block.setupMinutes > 0) {
      const setupEnd = addWorkingTime(time, machine.block.setupMinutes * 60, machine.downtimes);
      periods.push({ start: time, end: setupEnd, state: "setup" });
      workStart = setupEnd;
    }
    machine.lastJobIndex = part.jobIndex;
    const finish = addWorkingTime(workStart, machine.block.cycleSeconds, machine.downtimes);
    periods.push({ start: workStart, end: finish, state: "running" });
    events.push({ time: finish, kind: "finish", blockId: machine.block.id, part });
  };

  let lastTime = 0;
  let finished = true;
  while (events.size) {
    const event = events.pop();
    if (event.time > limit) { finished = false; break; }
    lastTime = Math.max(lastTime, event.time);
    const block = blocksById.get(event.blockId) as LineBlock;

    if (event.kind === "arrive") {
      if (block.kind === "source") sendOn(event.time, block.id, event.part);
      else if (block.kind === "sink") { jobs[event.part.jobIndex].good++; partDone(event.time, event.part); }
      else {
        const machine = machines.get(block.id) as MachineRun;
        machine.incoming--;
        machine.queue.push(event.part);
        machine.result.queueChanges.push({ time: event.time, size: machine.queue.length });
        machine.result.maxQueue = Math.max(machine.result.maxQueue, machine.queue.length);
        startNext(event.time, machine);
      }
      continue;
    }

    const machine = machines.get(block.id) as MachineRun;
    machine.busy = false;
    if (random() * 100 < machine.block.scrapPercent) {
      machine.result.partsScrapped++;
      jobs[event.part.jobIndex].scrapped++;
      partDone(event.time, event.part);
    } else {
      machine.result.partsMade++;
      sendOn(event.time, block.id, event.part);
    }
    startNext(event.time, machine);
  }

  const endSeconds = finished ? lastTime : limit;
  for (const job of jobs) job.late = job.finishSeconds === null || job.finishSeconds > job.dueSeconds;

  for (const machine of machines.values()) {
    const periods = fillPeriods(busyPeriods.get(machine.block.id) as StatePeriod[], machine.downtimes, endSeconds);
    machine.result.periods = periods;
    const total = (state: MachineState) => periods.filter((period) => period.state === state)
      .reduce((sum, period) => sum + period.end - period.start, 0);
    const percent = (seconds: number) => endSeconds > 0 ? Math.round(seconds / endSeconds * 1000) / 10 : 0;
    machine.result.busyPercent = percent(total("running") + total("setup"));
    machine.result.setupPercent = percent(total("setup"));
    machine.result.downPercent = percent(total("down"));
  }

  const machineResults = [...machines.values()].map((machine) => machine.result);
  const bottleneck = machineResults.reduce<MachineResult | null>(
    (best, machine) => machine.busyPercent > (best?.busyPercent ?? 0) ? machine : best, null);
  const goodParts = jobs.reduce((sum, job) => sum + job.good, 0);
  return {
    finished,
    endSeconds,
    goodParts,
    scrappedParts: jobs.reduce((sum, job) => sum + job.scrapped, 0),
    partsPerHour: endSeconds > 0 ? Math.round(goodParts / (endSeconds / 3600) * 10) / 10 : 0,
    bottleneckId: bottleneck?.blockId ?? null,
    machines: machineResults,
    jobs,
    moves,
  };
}

/**
 * Turn busy periods into a full timeline from 0 to `end`: breakdowns become "down"
 * (they pause setup and running), and gaps become "idle".
 */
function fillPeriods(busy: StatePeriod[], downtimes: { start: number; end: number }[], end: number): StatePeriod[] {
  const cuts = new Set<number>([0, end]);
  for (const period of busy) { cuts.add(period.start); cuts.add(period.end); }
  for (const down of downtimes) { cuts.add(Math.min(down.start, end)); cuts.add(Math.min(down.end, end)); }
  const times = [...cuts].filter((time) => time >= 0 && time <= end).sort((first, second) => first - second);
  const result: StatePeriod[] = [];
  let busyIndex = 0, downIndex = 0;
  for (let index = 0; index < times.length - 1; index++) {
    const start = times[index], stop = times[index + 1];
    if (stop <= start) continue;
    while (busyIndex < busy.length && busy[busyIndex].end <= start) busyIndex++;
    while (downIndex < downtimes.length && downtimes[downIndex].end <= start) downIndex++;
    const down = downIndex < downtimes.length && downtimes[downIndex].start <= start;
    const working = busyIndex < busy.length && busy[busyIndex].start <= start ? busy[busyIndex].state : "idle";
    const state: MachineState = down ? "down" : working;
    const last = result[result.length - 1];
    if (last && last.state === state && last.end === start) last.end = stop;
    else result.push({ start, end: stop, state });
  }
  return result;
}

// ---------------------------------------------------------------- playback helpers

/** The state of a machine at a moment in time (binary search over its periods). */
export function stateAt(periods: StatePeriod[], time: number): MachineState {
  let low = 0, high = periods.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (periods[middle].end <= time) low = middle + 1;
    else if (periods[middle].start > time) high = middle - 1;
    else return periods[middle].state;
  }
  return "idle";
}

/** Queue size at a moment in time. */
export function queueAt(changes: { time: number; size: number }[], time: number): number {
  let low = 0, high = changes.length - 1, size = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (changes[middle].time <= time) { size = changes[middle].size; low = middle + 1; }
    else high = middle - 1;
  }
  return size;
}

/** "Day 2, 06:30" style clock for a time in seconds from the start (Day 1, 00:00). */
export function formatSimTime(seconds: number): string {
  const day = Math.floor(seconds / SECONDS_PER_DAY) + 1;
  const inDay = seconds % SECONDS_PER_DAY;
  const hours = Math.floor(inDay / 3600);
  const minutes = Math.floor((inDay % 3600) / 60);
  return `Day ${day}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "3d 4h 10m" style length of time. */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}
