import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { TimePicker } from "../../components/TimePicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../../api/client";
import type { HolidayOut, MachineOut, Role, SettingsOut, ShiftOut, UserOut } from "../../api/types";
import { ConfirmDialog } from "../../components/Dialog";
import { DataTable, type Column } from "../../components/DataTable";
import { formatDate, nameLabel } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { MachineStatusBadge } from "../../components/StatusBadge";

type Tab = "users" | "machines" | "calendar" | "thresholds" | "demo";
const ROLES: Role[] = ["manager", "sales", "planner", "store", "qc", "admin"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function useSave(path: string, method: "POST" | "PATCH", invalidate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => apiFetch(path, { method, body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [invalidate] }),
  });
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("users");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<SettingsOut>("/settings") });
  const tabs: [Tab, string][] = [["users", "Users"], ["machines", "Machines"], ["calendar", "Shifts and holidays"], ["thresholds", "Business rules"]];
  if (settingsQuery.data?.app_mode === "demo") tabs.push(["demo", "Demo"]);

  return (
    <div>
      <PageHeader title="Settings" subtitle="People, machines, working time and the rules the agents follow." />
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {tabs.map(([key, label]) => <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {tab === "users" ? <UsersTab /> : null}
      {tab === "machines" ? <MachinesTab /> : null}
      {tab === "calendar" ? <CalendarTab /> : null}
      {tab === "thresholds" ? <QueryState query={settingsQuery}>{(settings) => <ThresholdsTab settings={settings} />}</QueryState> : null}
      {tab === "demo" ? <DemoTab /> : null}
    </div>
  );
}

function UsersTab() {
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: () => apiFetch<UserOut[]>("/users") });
  const users = usersQuery.data ?? [];
  const managers = users.filter((user) => user.role === "manager" && user.is_active);
  const queryClient = useQueryClient();
  const updateUser = useMutation({
    mutationFn: ({ userId, change }: { userId: string; change: Partial<UserOut> }) => apiFetch(`/users/${userId}`, { method: "PATCH", body: change }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
  const createUser = useSave("/users", "POST", "users");
  const [draft, setDraft] = useState({ name: "", email: "", role: "sales" as Role, password: "" });
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !/^\S+@\S+\.\S+$/.test(draft.email)) { setProblem("Enter a name and a valid email."); return; }
    if (draft.password.length < 10) { setProblem("The first password needs at least 10 characters."); return; }
    setProblem(null);
    createUser.mutate({ ...draft, name: draft.name.trim(), email: draft.email.trim().toLowerCase() }, { onSuccess: () => setDraft({ name: "", email: "", role: "sales", password: "" }) });
  }

  const columns: Column<UserOut>[] = [
    { key: "name", header: "Name", render: (user) => user.name, sortValue: (user) => user.name },
    { key: "email", header: "Email", render: (user) => user.email },
    { key: "role", header: "Role", render: (user) => (
      <Select aria-label={`Role of ${user.name}`} className="inline-input" value={user.role}
        onChange={(event) => updateUser.mutate({ userId: user.id, change: { role: event.target.value as Role } })}>
        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
      </Select>
    ) },
    { key: "backup", header: "Backup approver", render: (user) => (user.role === "manager" ? (
      <Select aria-label={`Backup approver for ${user.name}`} className="inline-input" value={user.backup_approver_id ?? ""}
        onChange={(event) => updateUser.mutate({ userId: user.id, change: { backup_approver_id: event.target.value || null } })}>
        <option value="">None</option>
        {managers.filter((manager) => manager.id !== user.id).map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
      </Select>
    ) : <span className="muted">—</span>) },
    { key: "active", header: "Active", render: (user) => (
      <input type="checkbox" aria-label={`${user.name} is active`} checked={user.is_active}
        onChange={(event) => updateUser.mutate({ userId: user.id, change: { is_active: event.target.checked } })} />
    ) },
  ];

  return (
    <div className="stack">
      {updateUser.isError ? <p className="error-text" role="alert">Could not update: {updateUser.error.message}</p> : null}
      <DataTable columns={columns} rows={users} rowKey={(user) => user.id} isLoading={usersQuery.isPending} error={usersQuery.error}
        onRetry={() => void usersQuery.refetch()} caption="Users" />
      <form className="card compact" onSubmit={submit} aria-label="Add a user" noValidate>
        <h2 className="section-title">Add a user</h2>
        <div className="grid-3">
          <div className="field"><label htmlFor="user-name">Name</label><input id="user-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="field"><label htmlFor="user-email">Email</label><input id="user-email" type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
          <div className="field"><label htmlFor="user-role">Role</label>
            <Select id="user-role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</Select></div>
        </div>
        <div className="field" style={{ maxWidth: 320 }}><label htmlFor="user-password">First password</label>
          <input id="user-password" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></div>
        {problem ? <p className="error-text" role="alert">{problem}</p> : null}
        {createUser.isError ? <p className="error-text" role="alert">{createUser.error.message}</p> : null}
        <button type="submit" className="button button-primary" disabled={createUser.isPending}>Add user</button>
      </form>
    </div>
  );
}

function MachinesTab() {
  const machinesQuery = useQuery({ queryKey: ["machines"], queryFn: () => apiFetch<MachineOut[]>("/machines") });
  const queryClient = useQueryClient();
  const updateMachine = useMutation({
    mutationFn: ({ machineId, change }: { machineId: string; change: Partial<MachineOut> }) => apiFetch(`/machines/${machineId}`, { method: "PATCH", body: change }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["machines"] }),
  });
  const createMachine = useSave("/machines", "POST", "machines");
  const [draft, setDraft] = useState({ code: "", name: "", machine_type: "", floor_x: "0", floor_y: "0" });
  const [problem, setProblem] = useState<string | null>(null);
  const position = (machine: MachineOut, axis: "floor_x" | "floor_y") => (
    <input type="number" min={0} max={20} className="inline-input" style={{ width: 64 }} aria-label={`${machine.code} ${axis === "floor_x" ? "floor x" : "floor y"}`}
      defaultValue={machine[axis]} onBlur={(event) => {
        const value = Number(event.target.value);
        if (Number.isInteger(value) && value >= 0 && value !== machine[axis]) updateMachine.mutate({ machineId: machine.id, change: { [axis]: value } });
      }} />
  );
  const columns: Column<MachineOut>[] = [
    { key: "code", header: "Code", render: (machine) => <strong>{machine.code}</strong>, sortValue: (machine) => machine.code },
    { key: "name", header: "Name", render: (machine) => machine.name },
    { key: "type", header: "Type", render: (machine) => machine.machine_type },
    { key: "status", header: "Status", render: (machine) => <MachineStatusBadge status={machine.status} /> },
    { key: "x", header: "Floor x", render: (machine) => position(machine, "floor_x") },
    { key: "y", header: "Floor y", render: (machine) => position(machine, "floor_y") },
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.code.trim() || !draft.name.trim() || !draft.machine_type.trim()) { setProblem("Code, name and type are needed."); return; }
    setProblem(null);
    createMachine.mutate({ ...draft, floor_x: Number(draft.floor_x), floor_y: Number(draft.floor_y) },
      { onSuccess: () => setDraft({ code: "", name: "", machine_type: "", floor_x: "0", floor_y: "0" }) });
  }

  return (
    <div className="stack">
      <p className="small muted">Floor x and y place the machine on the factory floor view (grid cells).</p>
      {updateMachine.isError ? <p className="error-text" role="alert">Could not update: {updateMachine.error.message}</p> : null}
      <DataTable columns={columns} rows={machinesQuery.data} rowKey={(machine) => machine.id} isLoading={machinesQuery.isPending}
        error={machinesQuery.error} onRetry={() => void machinesQuery.refetch()} caption="Machines" />
      <form className="card compact" onSubmit={submit} aria-label="Add a machine" noValidate>
        <h2 className="section-title">Add a machine</h2>
        <div className="grid-3">
          <div className="field"><label htmlFor="machine-code">Code</label><input id="machine-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></div>
          <div className="field"><label htmlFor="machine-name">Name</label><input id="machine-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="field"><label htmlFor="machine-type">Type (matches routing steps)</label><input id="machine-type" value={draft.machine_type} onChange={(event) => setDraft({ ...draft, machine_type: event.target.value })} /></div>
        </div>
        {problem ? <p className="error-text" role="alert">{problem}</p> : null}
        {createMachine.isError ? <p className="error-text" role="alert">{createMachine.error.message}</p> : null}
        <button type="submit" className="button button-primary" disabled={createMachine.isPending}>Add machine</button>
      </form>
    </div>
  );
}

function CalendarTab() {
  const shiftsQuery = useQuery({ queryKey: ["shifts"], queryFn: () => apiFetch<ShiftOut[]>("/shifts") });
  const holidaysQuery = useQuery({ queryKey: ["holidays"], queryFn: () => apiFetch<HolidayOut[]>("/holidays") });
  const createShift = useSave("/shifts", "POST", "shifts");
  const createHoliday = useSave("/holidays", "POST", "holidays");
  const [shift, setShift] = useState({ name: "Day", weekday: "1", start_time: "08:00", end_time: "17:00" });
  const [holiday, setHoliday] = useState({ holiday_date: "", name: "" });
  const shiftColumns: Column<ShiftOut>[] = [
    { key: "day", header: "Day", render: (row) => WEEKDAYS[row.weekday - 1] ?? row.weekday, sortValue: (row) => row.weekday * 10000 + Number(row.start_time.replace(":", "")) },
    { key: "name", header: "Shift", render: (row) => row.name },
    { key: "time", header: "Time", render: (row) => `${row.start_time.slice(0, 5)}–${row.end_time.slice(0, 5)}` },
  ];
  const holidayColumns: Column<HolidayOut>[] = [
    { key: "date", header: "Date", render: (row) => formatDate(row.holiday_date), sortValue: (row) => row.holiday_date },
    { key: "name", header: "Name", render: (row) => row.name },
  ];
  return (
    <div className="grid-2">
      <section className="stack" aria-label="Shifts">
        <DataTable columns={shiftColumns} rows={shiftsQuery.data} rowKey={(row) => row.id} isLoading={shiftsQuery.isPending} error={shiftsQuery.error} caption="Shifts" />
        <form className="card compact" aria-label="Add a shift" onSubmit={(event) => {
          event.preventDefault();
          if (shift.start_time < shift.end_time) createShift.mutate({ ...shift, weekday: Number(shift.weekday) });
        }}>
          <div className="grid-2">
            <div className="field"><label htmlFor="shift-day">Day</label><Select id="shift-day" value={shift.weekday} onChange={(event) => setShift({ ...shift, weekday: event.target.value })}>
              {WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</Select></div>
            <div className="field"><label htmlFor="shift-name">Name</label><input id="shift-name" value={shift.name} onChange={(event) => setShift({ ...shift, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="shift-start">Start</label><TimePicker id="shift-start" value={shift.start_time} required onChange={(start_time) => setShift({ ...shift, start_time })} /></div>
            <div className="field"><label htmlFor="shift-end">End</label><TimePicker id="shift-end" value={shift.end_time} required onChange={(end_time) => setShift({ ...shift, end_time })} /></div>
          </div>
          {shift.start_time >= shift.end_time ? <p className="error-text">End must be after start.</p> : null}
          <button type="submit" className="button" disabled={createShift.isPending}>Add shift</button>
        </form>
      </section>
      <section className="stack" aria-label="Holidays">
        <DataTable columns={holidayColumns} rows={holidaysQuery.data} rowKey={(row) => row.id} isLoading={holidaysQuery.isPending} error={holidaysQuery.error} caption="Holidays" />
        <form className="card compact" aria-label="Add a holiday" onSubmit={(event) => {
          event.preventDefault();
          if (holiday.holiday_date && holiday.name.trim()) createHoliday.mutate(holiday, { onSuccess: () => setHoliday({ holiday_date: "", name: "" }) });
        }}>
          <div className="grid-2">
            <div className="field"><label htmlFor="holiday-date">Date</label><DatePicker id="holiday-date" value={holiday.holiday_date} required onChange={(holiday_date) => setHoliday({ ...holiday, holiday_date })} /></div>
            <div className="field"><label htmlFor="holiday-name">Name</label><input id="holiday-name" value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} /></div>
          </div>
          <button type="submit" className="button" disabled={createHoliday.isPending || !holiday.holiday_date || !holiday.name.trim()}>Add holiday</button>
        </form>
      </section>
    </div>
  );
}

function ThresholdsTab({ settings }: { settings: SettingsOut }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(Object.entries(settings.values).map(([key, value]) => [key, String(value)])));
  const save = useSave("/settings", "PATCH", "settings");
  const invalid = Object.entries(values).filter(([, value]) => value.trim() === "" || Number.isNaN(Number(value)) || Number(value) < 0).map(([key]) => key);
  return (
    <form className="card compact" style={{ maxWidth: 640 }} aria-label="Business rules" onSubmit={(event) => {
      event.preventDefault();
      if (invalid.length === 0) save.mutate({ values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) });
    }}>
      <p className="small muted">Changes apply to new work right away. Currency {settings.currency}, time zone {settings.timezone}.</p>
      {Object.keys(values).sort().map((key) => (
        <div className="field" key={key}>
          <label htmlFor={`setting-${key}`}>{nameLabel(key)}</label>
          <input id={`setting-${key}`} inputMode="decimal" value={values[key]} aria-invalid={invalid.includes(key)}
            onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
        </div>
      ))}
      {invalid.length > 0 ? <p className="error-text">Every value must be a number of 0 or more.</p> : null}
      {save.isSuccess ? <p className="small" role="status">✓ Saved.</p> : null}
      {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
      <button type="submit" className="button button-primary" disabled={save.isPending || invalid.length > 0}>Save rules</button>
    </form>
  );
}

function DemoTab() {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const reset = useMutation({ mutationFn: () => apiFetch("/demo/reset", { method: "POST" }), onSuccess: () => void queryClient.invalidateQueries() });
  return (
    <div className="card compact" style={{ maxWidth: 560 }}>
      <h2 className="section-title">Reset demo data</h2>
      <p className="small">Deletes every order, approval and stock movement and loads the demo factory again. Everyone, including you, must log in again afterwards. Only possible in demo mode.</p>
      {reset.isSuccess ? <p className="small" role="status">✓ Demo data was reset.</p> : null}
      {reset.isError ? <p className="error-text" role="alert">Could not reset: {reset.error.message}</p> : null}
      <button type="button" className="button button-danger" disabled={reset.isPending} onClick={() => setConfirming(true)}>Reset demo data</button>
      <ConfirmDialog open={confirming} title="Reset all demo data?" danger confirmLabel="Reset" onClose={() => setConfirming(false)}
        message="All current demo orders and changes are lost. This cannot be undone."
        onConfirm={() => { setConfirming(false); reset.mutate(); }} />
    </div>
  );
}
