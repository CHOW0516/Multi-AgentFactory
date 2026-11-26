import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useBlocker } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { FloorCatalogItem, FloorDocument, FloorLayout, FloorMachine, LayoutMachine, MachineOut } from "../../api/types";
import { ConfirmDialog } from "../../components/Dialog";
import { useThemeStore } from "../../theme/theme-store";
import { FloorScene, type FloorSceneEditing } from "./FloorScene";
import { draftReducer, isMachine, layoutProblems, newItem, placementProblems, removeItem, replaceItem, sameDocument, startDraft, wallRun, type FloorItem } from "./editor-model";
import { floorKey, statusNames } from "./model";

type Cell = [number, number];
type Armed = { entry: FloorCatalogItem; existing?: LayoutMachine; item: FloorItem };
type Gesture = { item: FloorItem; start: Cell; offset: Cell; wall: boolean };
const textTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable=true], [role=combobox]"));

export function FloorEditor({ initial, liveMachines, onClose }: { initial: FloorLayout; liveMachines: FloorMachine[]; onClose(): void }) {
  const [state, dispatch] = useReducer(draftReducer, initial, startDraft);
  const [catalog, setCatalog] = useState(initial.catalog);
  const root = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ghost, setGhost] = useState<FloorItem | null>(null);
  const [armed, setArmedState] = useState<Armed | null>(null);
  const armedRef = useRef<Armed | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [cursor, setCursor] = useState<Cell>([20, 30]);
  const [problem, setProblem] = useState("");
  const [exitRequested, setExitRequested] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const client = useQueryClient();
  const allMachines = useQuery({ queryKey: ["machines"], queryFn: ({ signal }) => apiFetch<MachineOut[]>("/machines", { signal }) });
  const doc = state.present;
  const dirty = !sameDocument(doc, state.saved);
  const errors = layoutProblems(doc, catalog);
  const item = [...doc.machines, ...doc.decor].find((part) => part.id === selected);
  const setArmed = (value: Armed | null) => { armedRef.current = value; setArmedState(value); };
  const save = useMutation({
    mutationFn: () => apiFetch<FloorLayout>("/floor/layout", { method: "PUT", body: { ...doc, revision: state.revision } }),
    onSuccess: (layout) => {
      dispatch({ type: "saved", layout });
      setCatalog(layout.catalog);
      client.setQueryData(["floor-layout"], layout);
      void client.invalidateQueries({ queryKey: floorKey });
      void client.invalidateQueries({ queryKey: ["machines"] });
      void client.invalidateQueries({ queryKey: ["p5", "machine"] });
      setProblem("");
    },
  });
  const blocker = useBlocker(dirty || save.isPending);

  useEffect(() => {
    if (!dirty && !save.isPending) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const logout = (event: Event) => {
      event.preventDefault();
      if (save.isPending) { setProblem("Wait for the save to finish before leaving."); return; }
      setLeaveAction(() => (event as CustomEvent<{ proceed(): void }>).detail.proceed);
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("workspace-leave", logout);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("workspace-leave", logout); };
  }, [dirty, save.isPending]);

  useEffect(() => {
    if (blocker.state === "blocked" && !dirty && !save.isPending) blocker.proceed();
  }, [blocker, dirty, save.isPending]);

  const cancelGesture = () => { gesture.current = null; setGhost(null); };
  const commit = (next: FloorDocument) => { dispatch({ type: "commit", document: next }); setProblem(""); save.reset(); };
  const updateItem = (next: FloorItem) => {
    const invalid = placementProblems(doc, next, catalog);
    if (invalid.length) { setProblem(invalid[0]); return false; }
    commit(replaceItem(doc, next));
    return true;
  };
  const arm = (entry: FloorCatalogItem, existing?: LayoutMachine) => {
    cancelGesture();
    const next = existing ? { ...existing, x: cursor[0], y: cursor[1] } : newItem(entry, [...doc.machines, ...(allMachines.data ?? [])], { x: cursor[0], y: cursor[1] });
    setArmed({ entry, existing, item: next }); setGhost(next); setSelected(null); setProblem("");
    root.current?.querySelector<SVGSVGElement>(".floor-model")?.focus();
  };
  const atCell = (cell: Cell, moving = gesture.current): FloorItem | null => {
    if (moving) return moving.wall && !isMachine(moving.item) ? wallRun(moving.item, moving.start, cell) :
      { ...moving.item, x: cell[0] - moving.offset[0], y: cell[1] - moving.offset[1] };
    return armedRef.current ? { ...armedRef.current.item, x: cell[0], y: cell[1] } : null;
  };
  const place = (next: FloorItem | null) => {
    if (!next) return;
    if (updateItem(next)) { setSelected(next.id); setArmed(null); setGhost(null); }
  };
  const rotate = () => {
    const next = ghost ?? item;
    if (!next || save.isPending) return;
    const rotated = { ...next, rotation: ((next.rotation + 90) % 360) as FloorItem["rotation"] };
    if (armedRef.current) { setArmed({ ...armedRef.current, item: rotated }); setGhost(rotated); }
    else if (!gesture.current) updateItem(rotated);
  };
  const remove = () => { if (item && !save.isPending) { commit(removeItem(doc, item.id)); setSelected(null); cancelGesture(); } };
  const history = (type: "undo" | "redo") => { if (!save.isPending) { cancelGesture(); setArmed(null); setProblem(""); save.reset(); dispatch({ type }); } };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (textTarget(event.target) || save.isPending) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
      event.preventDefault(); history(key === "y" || event.shiftKey ? "redo" : "undo");
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === "r") { event.preventDefault(); rotate(); }
      if (key === "delete" || key === "backspace") { event.preventDefault(); remove(); }
      if (key === "escape") { cancelGesture(); setArmed(null); }
    }
  };
  const sceneKeyDown: FloorSceneEditing["onKeyDown"] = (event) => {
    if (event.target !== event.currentTarget || save.isPending) return;
    const delta: Record<string, Cell> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (delta[event.key]) {
      event.preventDefault();
      const [dx, dy] = delta[event.key];
      const next: Cell = [Math.max(0, Math.min(doc.columns - 1, cursor[0] + dx)), Math.max(0, Math.min(doc.rows - 1, cursor[1] + dy))];
      setCursor(next); setGhost(atCell(next));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      place(atCell(cursor) ?? (item ? { ...item, x: cursor[0], y: cursor[1] } : null));
    }
  };
  const sceneEditor: FloorSceneEditing = {
    selected, ghost, cursor, disabled: save.isPending, valid: !ghost || placementProblems(doc, ghost, catalog).length === 0,
    onDown(cell, id) {
      setCursor(cell);
      const target = [...doc.machines, ...doc.decor].find((entry) => entry.id === id);
      if (armedRef.current) {
        const next = atCell(cell)!;
        gesture.current = { item: next, start: cell, offset: [0, 0], wall: !isMachine(next) && next.kind === "wall" };
        setGhost(next);
      } else if (target) {
        setArmed(null); setSelected(target.id);
        gesture.current = { item: target, start: cell, offset: [cell[0] - target.x, cell[1] - target.y], wall: false };
        setGhost(target);
      } else { setSelected(null); cancelGesture(); }
    },
    onMove(cell) { setCursor(cell); setGhost(atCell(cell)); },
    onUp(cell) { if (gesture.current) { const next = atCell(cell); gesture.current = null; place(next); if (!armedRef.current) setGhost(null); } },
    onDrop(cell) { place(atCell(cell)); },
    onCancel: cancelGesture, onKeyDown: sceneKeyDown,
  };
  const sceneMachines: FloorMachine[] = doc.machines.map((machine) => ({
    status: "idle", current_order_number: null, part_count: 0, utilisation_today: 0,
    ...liveMachines.find((live) => live.id === machine.id), ...machine,
    floor_x: doc.origin_x + machine.x * 10, floor_y: doc.origin_y + machine.y * 10,
  }));
  const leave = () => { if (save.isPending) return; if (dirty) setExitRequested(true); else onClose(); };
  const selectedEntry = item && catalog.find((entry) => entry.kind === (isMachine(item) ? item.machine_type : item.kind) && (entry.category === "Machines") === isMachine(item));
  const unplaced = (allMachines.data ?? []).filter((machine) => !doc.machines.some((placed) => placed.id === machine.id));
  const select = (id: string) => { if (!save.isPending) { setSelected(id); setArmed(null); cancelGesture(); } };

  return <section ref={root} className="floor-workspace floor-editor p5-page iso" data-theme={theme} aria-label="Floor editor" onKeyDown={keyDown}>
    <FloorScene machines={sceneMachines} approvals={0} active={selected} onInspect={select} onHover={() => undefined}
      arrival={null} layout={{ ...doc, catalog }} editor={sceneEditor} />
    <header className="floor-editor-toolbar floor-panel">
      <div><h1>Edit floor</h1><span role="status">{save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span></div>
      <div className="floor-editor-actions">
        <button className="button" type="button" disabled={!state.past.length || save.isPending} onClick={() => history("undo")} title="Ctrl/Cmd+Z">Undo</button>
        <button className="button" type="button" disabled={!state.future.length || save.isPending} onClick={() => history("redo")} title="Ctrl/Cmd+Shift+Z or Ctrl+Y">Redo</button>
        <button className="button" type="button" disabled={!(item || armed) || save.isPending} onClick={rotate}>Rotate 90°</button>
        <button className="button" type="button" disabled={!item || save.isPending} onClick={remove}>Remove</button>
        <button className="button button-primary" type="button" disabled={!dirty || errors.length > 0 || save.isPending || Boolean(ghost)} onClick={() => save.mutate()}>Save</button>
        <button className="button" type="button" disabled={save.isPending} onClick={() => { dispatch({ type: "cancel" }); onClose(); }}>Cancel</button>
        <button className="button" type="button" disabled={save.isPending} onClick={leave} aria-pressed="true">Exit edit mode</button>
      </div>
    </header>
    <aside className="floor-editor-palette floor-panel" aria-label="Item palette">
      <h2>Place items</h2><p className="small muted">Drag onto the floor, or select an item then click a cell. Draw a wall with one drag.</p>
      {(["Machines", "Structure", "Furniture", "Markings"] as const).map((category) => <section key={category}>
        <h3>{category}</h3><div className="floor-palette-items">{catalog.filter((entry) => entry.category === category).map((entry) =>
          <button className="floor-palette-item" type="button" key={entry.kind} draggable={!save.isPending} disabled={save.isPending}
            aria-label={`Add ${entry.label}`}
            aria-pressed={armed?.entry === entry && !armed.existing} onClick={() => arm(entry)}
            onDragStart={(event) => { arm(entry); event.dataTransfer.setData("text/plain", entry.kind); event.dataTransfer.effectAllowed = "copy"; }}>
            <span>{entry.label}</span><small>{entry.width} × {entry.height}</small>
          </button>)}</div>
      </section>)}
      {allMachines.isError && <p role="alert" className="error-text">Could not load unplaced machines. <button type="button" className="button" onClick={() => void allMachines.refetch()}>Retry</button></p>}
      {unplaced.length > 0 && <section><h3>Unplaced machines</h3>{unplaced.map((machine) => {
        const entry = catalog.find((part) => part.category === "Machines" && part.kind === machine.machine_type) ??
          { kind: machine.machine_type, label: machine.machine_type, category: "Machines" as const, width: 12, height: 9, solid: true, resizable: false };
        const existing: LayoutMachine = { id: machine.id, code: machine.code, name: machine.name, machine_type: machine.machine_type, x: 0, y: 0, rotation: 0 };
        return <button key={machine.id} type="button" className="floor-palette-item" disabled={save.isPending} draggable={!save.isPending}
          aria-label={`Place ${machine.code}`}
          onClick={() => arm(entry, existing)} onDragStart={(event) => { arm(entry, existing); event.dataTransfer.setData("text/plain", machine.id); }}>
          <span>{machine.code}</span><small>{machine.name}</small></button>;
      })}</section>}
    </aside>
    <aside className="floor-editor-properties floor-panel" aria-label="Layout properties">
      <h2>{item ? "Selected item" : "Floor"}</h2>
      {item ? <div className="stack" key={item.id}>
        <div className="field"><label htmlFor="floor-item-name">Name</label><input key={item.name} id="floor-item-name" defaultValue={item.name} maxLength={120} disabled={save.isPending}
          onBlur={(e) => { if (!updateItem({ ...item, name: e.target.value.trim() })) e.target.value = item.name; }} /></div>
        {isMachine(item) && <>
          <div className="field"><label htmlFor="floor-machine-code">Machine code</label><input key={item.code} id="floor-machine-code" defaultValue={item.code} maxLength={30} disabled={save.isPending}
            onBlur={(e) => { if (!updateItem({ ...item, code: e.target.value.trim() })) e.target.value = item.code; }} /></div>
          <div className="field"><label htmlFor="floor-machine-type">Machine type</label><input key={item.machine_type} id="floor-machine-type" list="floor-machine-types" defaultValue={item.machine_type} maxLength={40} disabled={save.isPending}
            onBlur={(e) => { if (!updateItem({ ...item, machine_type: e.target.value.trim() })) e.target.value = item.machine_type; }} />
            <datalist id="floor-machine-types">{catalog.filter((e) => e.category === "Machines").map((e) => <option key={e.kind} value={e.kind} />)}</datalist></div>
          <p className="small muted">Removing this item leaves its production record and history intact.</p>
          <p className="small">Production status: {statusNames[liveMachines.find((machine) => machine.id === item.id)?.status ?? "idle"]}</p>
        </>}
        <p className="small">ID <code className="floor-item-id">{item.id}</code></p><p className="small">Rotation: {item.rotation}°</p>
        {!isMachine(item) && <p className="small">Type: {selectedEntry?.label ?? item.kind}</p>}
        {!isMachine(item) && selectedEntry?.resizable && <div className="grid-2">{(["width", "height"] as const).filter((axis) => item.kind !== "wall" || axis === "width").map((axis) =>
          <div className="field" key={axis}><label htmlFor={`floor-item-${axis}`}>{axis === "width" && item.kind === "wall" ? "Wall length" : axis === "width" ? "Width" : "Depth"} (cells)</label>
            <input key={item[axis]} id={`floor-item-${axis}`} type="number" min={1} max={10000} defaultValue={item[axis]} disabled={save.isPending}
              onBlur={(e) => { if (!updateItem({ ...item, [axis]: Number(e.target.value) })) e.target.value = String(item[axis]); }} /></div>)}</div>}
      </div> : <p className="small muted">Select a machine or decoration to edit it. Each cell is 10 world units.</p>}
      <form className="stack floor-resize-form" key={`${doc.columns}/${doc.rows}`} onSubmit={(event) => {
        event.preventDefault(); const fields = new FormData(event.currentTarget);
        const next = { ...doc, columns: Number(fields.get("columns")), rows: Number(fields.get("rows")) };
        const invalid = layoutProblems(next, catalog).filter((error) => error.startsWith("Outside") || error.startsWith("Floor dimensions"));
        if (invalid.length) setProblem(`Resize blocked. ${invalid[0]}`); else commit(next);
      }}>
        <h3>Floor size</h3><div className="grid-2">
          <div className="field"><label htmlFor="floor-columns">Width (cells)</label><input id="floor-columns" name="columns" type="number" required min={1} max={10000} step={1} defaultValue={doc.columns} disabled={save.isPending} /></div>
          <div className="field"><label htmlFor="floor-rows">Depth (cells)</label><input id="floor-rows" name="rows" type="number" required min={1} max={10000} step={1} defaultValue={doc.rows} disabled={save.isPending} /></div>
        </div><button className="button" disabled={save.isPending}>Resize floor</button>
      </form>
    </aside>
    <div className="floor-editor-notice floor-panel" role={problem || save.isError || errors.length ? "alert" : "status"}>
      {save.isError ? <p className="error-text">Save failed: {save.error.message} Your draft is still open.</p> : problem ? <p className="error-text">{problem}</p> :
        <p>{armed ? `Placing ${armed.entry.label}. Click a cell or use arrows and Enter.` : "R rotates · Delete removes · Ctrl/Cmd+Z undoes · Right-drag pans · Alt+arrows orbit"}</p>}
      {errors.length > 0 && <details><summary>{errors.length} layout issue{errors.length === 1 ? "" : "s"} to resolve before Save</summary><ul>{errors.slice(0, 12).map((error, i) => <li key={i}>{error}</li>)}</ul></details>}
      {ghost && <p>{sceneEditor.valid ? "Placement valid" : placementProblems(doc, ghost, catalog)[0]}</p>}
    </div>
    <ConfirmDialog open={!save.isPending && (exitRequested || blocker.state === "blocked" || Boolean(leaveAction))}
      title="Discard unsaved floor changes?" message="Your draft will be discarded. The last saved layout will be kept." confirmLabel="Discard changes" danger
      onClose={() => { setExitRequested(false); setLeaveAction(null); if (blocker.state === "blocked") blocker.reset(); }}
      onConfirm={() => { if (blocker.state === "blocked") blocker.proceed(); else { onClose(); leaveAction?.(); } }} />
  </section>;
}
