"use client";

import { useEffect, useMemo, useState } from "react";
import Shell, { client, useApp, type Member } from "../components/Shell";
import "./settings.css";
import { isValidDate, singaporeDate } from "../lib/OilExpiry";

const FIELDS = [
  "rank", "name", "email", "phone", "driver", "appointment",
  "al", "oil", "phol", "total_leave_balance", "total_duties", "mc_count",
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;
const empty: Form = {
  rank: "CPL", name: "", email: "", phone: "", driver: "no", appointment: "",
  al: "0", oil: "0", phol: "0", total_leave_balance: "0", total_duties: "0", mc_count: "0",
};
const RANKS = ["LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP"];
const APPOINTMENTS = ["", "FF", "SC", "RC", "DRC"];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(field);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function validate(row: Form): string[] {
  const errors: string[] = [];
  if (!RANKS.includes(row.rank.trim().toUpperCase())) errors.push("Invalid rank");
  if (!row.name.trim()) errors.push("Missing name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) errors.push("Invalid email");
  if (!/^\+?[0-9 ()-]{7,20}$/.test(row.phone.trim())) errors.push("Invalid phone");
  if (!["yes", "no", "true", "false", "1", "0"].includes(row.driver.trim().toLowerCase())) errors.push("Invalid driver");
  if (!APPOINTMENTS.includes(row.appointment.trim().toUpperCase())) errors.push("Invalid appointment");
  for (const field of ["al", "oil", "phol", "total_leave_balance", "total_duties", "mc_count"] as const) {
    if (!row[field].trim() || !Number.isFinite(Number(row[field])) || Number(row[field]) < 0) errors.push("Invalid " + field);
  }
  if (!Number.isInteger(Number(row.mc_count))) errors.push("MC count must be whole");
  const sum = Number(row.al) + Number(row.oil) + Number(row.phol);
  if (Math.abs(sum - Number(row.total_leave_balance)) > 0.001) errors.push("Total balance mismatch");
  if (Math.abs(sum / 2 - Number(row.total_duties)) > 0.001) errors.push("Total duties mismatch");
  return errors;
}

function SettingsContent() {
  const { isApprover } = useApp();
  const [strength, setStrength] = useState("34");
  const [strengthExists, setStrengthExists] = useState(false);
  const [form, setForm] = useState<Form>({ ...empty });
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [awardMemberId, setAwardMemberId] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const [awardExpiry, setAwardExpiry] = useState("");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<Form[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<{ email: string; temporaryPassword: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isApprover) return;
    client.models.RotaSettings.get({ id: "main" }).then(({ data }) => {
      if (data) { setStrength(String(data.strength)); setStrengthExists(true); }
    }).catch(() => setMessage("Could not load rota strength."));
    client.models.Member.list({ limit: 1000 }).then(({ data, errors }) => {
      if (errors?.length) setMessage(errors[0].message);
      else setMembers([...data]);
    }).catch(() => setMessage("Could not load members."));
  }, [isApprover]);

  const selected = members.find(m => m.id === selectedId);
  const duplicates = useMemo(() => {
    const known = new Set(members.map(m => m.email.toLowerCase()));
    const seen = new Set<string>();
    return rows.map(r => {
      const email = r.email.trim().toLowerCase();
      const issues = validate(r);
      if (known.has(email) || seen.has(email)) issues.push("Duplicate email");
      seen.add(email);
      return issues;
    });
  }, [rows, members]);

  if (!isApprover) return <p>Only KAH (LTA or WO2) can access Settings.</p>;

  async function saveStrength() {
    const value = Number(strength);
    if (!Number.isInteger(value) || value < 1 || value > 10000) {
      setMessage("Strength must be a whole number between 1 and 10000."); return;
    }
    setBusy(true); setMessage("");
    try {
      const response = strengthExists
        ? await client.models.RotaSettings.update({ id: "main", strength: value })
        : await client.models.RotaSettings.create({ id: "main", strength: value });
      if (response.errors?.length) throw new Error(response.errors[0].message);
      setStrengthExists(true); setMessage("Rota strength saved.");
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }

  async function createAccount(input: Form) {
    const { data, errors } = await client.mutations.createPersonnelAccount(input);
    if (errors?.length || !data?.temporaryPassword) throw new Error(errors?.[0]?.message ?? "Account creation failed.");
    return { email: data.email, temporaryPassword: data.temporaryPassword };
  }

  async function addManual() {
    const issues = validate(form);
    if (members.some(m => m.email.toLowerCase() === form.email.trim().toLowerCase())) issues.push("Duplicate email");
    if (issues.length) { setMessage(issues.join("; ")); return; }
    setBusy(true); setMessage(""); setCredentials([]);
    try {
      const result = await createAccount(form);
      setCredentials([result]);
      setMessage("Account created. Copy the temporary password now; it will not be shown again after leaving this page.");
      setForm({ ...empty });
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }

  function previewCsv() {
    try {
      const parsed = parseCsv(csv.replace(/^\uFEFF/, ""));
      const header = parsed.shift()?.map(v => v.trim().toLowerCase()) ?? [];
      if (header.length !== FIELDS.length || FIELDS.some((f, i) => header[i] !== f)) {
        throw new Error("CSV headers must exactly match: " + FIELDS.join(","));
      }
      if (parsed.length > 100) throw new Error("Import a maximum of 100 accounts per batch.");
      setRows(parsed.map(values => {
        if (values.length !== FIELDS.length) throw new Error("Incorrect column count in CSV.");
        return Object.fromEntries(FIELDS.map((field, i) => [field, values[i]])) as Form;
      }));
      setResults([]); setCredentials([]); setMessage("CSV preview ready. Review each row before importing.");
    } catch (e) { setRows([]); setMessage(String(e)); }
  }

  async function importCsv() {
    if (!rows.length || duplicates.some(errors => errors.length)) {
      setMessage("Resolve all validation and duplicate errors before importing."); return;
    }
    setBusy(true); setMessage(""); setCredentials([]);
    const reports: string[] = [], secrets: { email: string; temporaryPassword: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        secrets.push(await createAccount(row));
        reports.push(`Row ${i + 2}: created ${row.email}`);
      } catch (e) {
        reports.push(`Row ${i + 2}: FAILED ${row.email} — ${String(e)}`);
      }
      setResults([...reports]); setCredentials([...secrets]);
    }
    setBusy(false);
    setMessage("Import finished. Save the credentials securely now. Failed rows can be corrected and retried individually.");
  }

  async function awardOil() {
    const amount = Number(awardAmount);
    if (!awardMemberId || !members.some(m => m.id === awardMemberId)) {
      setMessage("Select a personnel member to receive OIL."); return;
    }
    if (!awardAmount.trim() || !Number.isFinite(amount) || amount <= 0 ||
        Math.round(amount * 100) !== amount * 100) {
      setMessage("Enter a positive OIL amount (up to two decimal places)."); return;
    }
    if (!isValidDate(awardExpiry) || awardExpiry < singaporeDate()) {
      setMessage("Enter a valid expiry date that has not passed (Singapore time)."); return;
    }
    setBusy(true); setMessage("");
    try {
      const { errors } = await client.models.OilCredit.create({
        memberId: awardMemberId,
        amount,
        remaining: amount,
        expiryDate: awardExpiry,
        awardedAt: new Date().toISOString(),
        awardedBy: "KAH",
      });
      if (errors?.length) throw new Error(errors[0].message);
      setAwardAmount("");
      setAwardExpiry("");
      setMessage("OIL award recorded. The member can view its expiry date in My Info.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not record OIL award.");
    } finally {
      setBusy(false);
    }
  }

  async function updateGroups() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const { data, errors } = await client.mutations.updatePersonnelGroups({
        memberId: selected.id,
        rank: form.rank,
        driver: form.driver === "yes",
        appointment: form.appointment,
      });
      if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "Group update failed.");
      setMessage("Personnel rank, driver and appointment groups updated.");
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }

  async function updateMember() {
    if (!selected) return;
    setBusy(true); setMessage("");
    const al = Number(form.al), oil = Number(form.oil), phol = Number(form.phol);
    if ([al, oil, phol].some(n => !Number.isFinite(n) || n < 0) || !Number.isInteger(Number(form.mc_count)) || Number(form.mc_count) < 0 || !form.name.trim()) {
      setBusy(false); setMessage("Invalid balances."); return;
    }
    try {
      const { errors } = await client.models.Member.update({
        id: selected.id, name: form.name.trim(),
        phone: form.phone, al, oil, phol,
        totalLeaveBalance: al + oil + phol, totalDuties: (al + oil + phol) / 2,
        mcCount: Number(form.mc_count),
      });
      if (errors?.length) throw new Error(errors[0].message);
      setMessage("Member record updated. Rank, driver and appointment groups are managed in Cognito.");
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="settings-page">
      <div className="settings-intro"><div><span className="settings-eyebrow">Administration / KAH only</span><h2>KAH Settings</h2><p>Manage your unit strength, personnel accounts and access in one place.</p></div><span className="settings-access">● Restricted access</span></div>
      {message && <p className="settings-feedback" role="status">{message}</p>}
      <section className="settings-card settings-strength">
        <div className="settings-card-heading"><span className="settings-card-icon" aria-hidden="true">01</span><div><h3>Rota manpower strength</h3><p>Set the active personnel count used by the dashboard.</p></div></div>
        <div className="settings-strength-controls"><label>Personnel count
          <input type="number" min="1" max="10000" value={strength} onChange={e => setStrength(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={saveStrength}>Save strength</button></div>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><span className="settings-card-icon" aria-hidden="true">02</span><div><h3>Create personnel account</h3><p>Register a member and generate their initial sign-in credentials.</p></div></div>
        <p><small>New accounts receive a temporary password and must change it at first sign-in. Cognito invitations are suppressed.</small></p>
        <div className="settings-form-grid">
          {FIELDS.map(field => (
            <label key={field} className={["name","email"].includes(field) ? "settings-field-wide" : ""}>
              {field.replaceAll("_", " ")}
              {field === "rank" ? (
                <select value={form.rank} onChange={e => setForm(v => ({ ...v, rank: e.target.value }))}>
                  {RANKS.map(r => <option key={r}>{r}</option>)}
                </select>
              ) : field === "appointment" ? (
                <select value={form.appointment} onChange={e => setForm(v => ({ ...v, appointment: e.target.value }))}>
                  {APPOINTMENTS.map(a => <option key={a} value={a}>{a || "None"}</option>)}
                </select>
              ) : field === "driver" ? (
                <select value={form.driver} onChange={e => setForm(v => ({ ...v, driver: e.target.value }))}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              ) : (
                <input type={field === "email" ? "email" : ["al","oil","phol","total_leave_balance","total_duties","mc_count"].includes(field) ? "number" : "text"}
                  step="any" value={form[field]} onChange={e => setForm(v => ({ ...v, [field]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
        <div className="settings-actions"><button type="button" disabled={busy} onClick={addManual}>Create personnel account</button></div>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><span className="settings-card-icon" aria-hidden="true">03</span><div><h3>Bulk account import</h3><p>Paste a CSV, validate each row and review the results before creating accounts.</p></div></div>
        <p className="settings-helper">Required CSV headers (in order): <code>{FIELDS.join(", ")}</code></p>
        <textarea aria-label="CSV account data" rows={7} value={csv} onChange={e => setCsv(e.target.value)} placeholder="Paste CSV with a header row" />
        <div className="settings-actions"><button className="ghost" type="button" disabled={busy} onClick={previewCsv}>Preview and validate CSV</button></div>
        {!!rows.length && (
          <>
            <p>{rows.length} rows ready for review.</p>
            <div className="settings-table-wrap">
              <table><thead><tr><th>Row</th><th>Email</th><th>Validation</th></tr></thead>
                <tbody>{rows.map((row, i) => <tr key={i}>
                  <td>{i + 2}</td><td>{row.email}</td>
                  <td>{duplicates[i].length ? duplicates[i].join("; ") : "Valid"}</td>
                </tr>)}</tbody></table>
            </div>
            <button type="button" disabled={busy || duplicates.some(v => v.length > 0)} onClick={importCsv}>Import validated accounts</button>
          </>
        )}
        {!!results.length && <ul>{results.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </section>
      {!!credentials.length && (
        <section className="settings-card settings-credentials">
          <h3>Temporary credentials — copy now</h3>
          <p><strong>These passwords are displayed only in this session. Store them securely.</strong></p>
          <div className="settings-table-wrap">
            <table><thead><tr><th>Email</th><th>Temporary password</th></tr></thead>
              <tbody>{credentials.map(v => <tr key={v.email}><td>{v.email}</td><td><code>{v.temporaryPassword}</code></td></tr>)}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => setCredentials([])}>Clear displayed passwords</button>
        </section>
      )}
      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon" aria-hidden="true">04</span>
          <div><h3>Award new OIL</h3><p>Record a separate OIL award and its expiry date for a member.</p></div>
        </div>
        <div className="settings-form-grid">
          <label>Personnel member
            <select value={awardMemberId} onChange={e => setAwardMemberId(e.target.value)}>
              <option value="">Select a member</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.rank} {m.name} ({m.email})</option>)}
            </select>
          </label>
          <label>OIL amount
            <input type="number" min="0.01" step="0.01" value={awardAmount}
              onChange={e => setAwardAmount(e.target.value)} placeholder="e.g. 1.5" />
          </label>
          <label>Expiry date
            <input type="date" min={singaporeDate()} value={awardExpiry}
              onChange={e => setAwardExpiry(e.target.value)} />
          </label>
        </div>
        <p><small>Each award is stored individually. The existing Member OIL total is not modified until the balance-ledger integration is completed.</small></p>
        <div className="settings-actions">
          <button type="button" disabled={busy} onClick={awardOil}>Submit OIL award</button>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><span className="settings-card-icon" aria-hidden="true">05</span><div><h3>Edit personnel record</h3><p>Update personnel details and manage Cognito account roles.</p></div></div>
        <label className="settings-member-picker">Select personnel<select value={selectedId} onChange={e => {
          const m = members.find(x => x.id === e.target.value);
          setSelectedId(e.target.value);
          if (m) setForm({
            rank: m.rank ?? "", name: m.name, email: m.email, phone: m.phone ?? "",
            driver: m.driver ? "yes" : "no", appointment: m.appointment ?? "",
            al: String(m.al ?? 0), oil: String(m.oil ?? 0), phol: String(m.phol ?? 0),
            total_leave_balance: String(m.totalLeaveBalance ?? 0),
            total_duties: String(m.totalDuties ?? 0), mc_count: String(m.mcCount ?? 0),
          });
        }}>
          <option value="">Select a member</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.rank} {m.name} ({m.email})</option>)}
        </select></label>
        {selected && <div className="settings-edit-panel">
          <p>Editing {selected.name}. Email changes are not supported. Rank, driver and appointment are synchronized separately with Cognito.</p>
          <div className="settings-form-grid">{(["name", "phone", "al", "oil", "phol", "mc_count"] as const).map(field => (
            <label key={field}>{field}
              <input value={form[field]} onChange={e => setForm(v => ({ ...v, [field]: e.target.value }))} />
            </label>
          ))}
          </div><div className="settings-actions"><button type="button" disabled={busy} onClick={updateMember}>Save member details</button></div>
          <h4>Account roles</h4><div className="settings-form-grid">
          <label>Rank <select value={form.rank} onChange={e => setForm(v => ({ ...v, rank: e.target.value }))}>{RANKS.map(r => <option key={r}>{r}</option>)}</select></label>
          <label>Driver <select value={form.driver} onChange={e => setForm(v => ({ ...v, driver: e.target.value }))}><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label>Appointment <select value={form.appointment} onChange={e => setForm(v => ({ ...v, appointment: e.target.value }))}>{APPOINTMENTS.map(a => <option key={a} value={a}>{a || "None"}</option>)}</select></label>
          </div><div className="settings-actions"><button type="button" disabled={busy} onClick={updateGroups}>Save Cognito roles</button></div>
        </div>}
      </section>
    </div>
  );
}

export default function Page() {
  return <Shell><SettingsContent /></Shell>;
}
