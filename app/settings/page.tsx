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

type OilCreditRow = { id: string; memberId: string; amount?: number | null; remaining?: number | null; expiryDate: string; awardedAt?: string | null; voidedAt?: string | null };

type BulkOilRow = {
  email: string;
  amount: string;
  expiryDate: string;
  requestId: string;
  line: number;
};

function displayDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value;
}

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
  const [addToOic, setAddToOic] = useState(false);
  const [awardMemberId, setAwardMemberId] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const [awardExpiry, setAwardExpiry] = useState("");
  const [bulkOilCsv, setBulkOilCsv] = useState("");
  const [bulkOilRows, setBulkOilRows] = useState<BulkOilRow[]>([]);
  const [bulkOilResults, setBulkOilResults] = useState<string[]>([]);
  const [oilCredits, setOilCredits] = useState<OilCreditRow[]>([]);
  const [manageExpiryFilter, setManageExpiryFilter] = useState("");
  const [manageSelectedIds, setManageSelectedIds] = useState<string[]>([]);
  const [manageNewExpiry, setManageNewExpiry] = useState("");
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
    refreshOilCredits().catch(() => setMessage("Could not load OIL award records."));
  }, [isApprover]);

  const selected = members.find(m => m.id === selectedId);
  const activeOilCredits = oilCredits.filter(credit => !credit.voidedAt && Number(credit.remaining ?? 0) > 0 && credit.expiryDate >= singaporeDate());
  const expiryDates = [...new Set(activeOilCredits.map(credit => credit.expiryDate))].sort();
  const filteredOilCredits = activeOilCredits.filter(credit => !manageExpiryFilter || credit.expiryDate === manageExpiryFilter);
  const selectedOilTotal = filteredOilCredits.filter(credit => manageSelectedIds.includes(credit.id)).reduce((sum, credit) => sum + Number(credit.remaining ?? 0), 0);

  async function refreshOilCredits() {
    const { data, errors } = await client.models.OilCredit.list({ limit: 1000 });
    if (errors?.length) throw new Error(errors[0].message);
    setOilCredits(data.map(credit => ({
      id: credit.id, memberId: credit.memberId, amount: credit.amount,
      remaining: credit.remaining, expiryDate: credit.expiryDate,
      awardedAt: credit.awardedAt, voidedAt: credit.voidedAt,
    })) as OilCreditRow[]);
  }

  async function manageOil(action: "CHANGE_EXPIRY" | "VOID") {
    if (!manageSelectedIds.length) { setMessage("Select at least one active OIL award."); return; }
    if (action === "CHANGE_EXPIRY" && (!isValidDate(manageNewExpiry) || manageNewExpiry < singaporeDate())) {
      setMessage("Choose a valid new expiry date that has not passed."); return;
    }
    if (action === "VOID" && !window.confirm(
      `Void ${manageSelectedIds.length} selected OIL award(s)? Unused OIL will be removed from personnel balances. This cannot be undone.`
    )) return;
    setBusy(true); setMessage("");
    try {
      const { data, errors } = await client.mutations.manageOilCredits({
        action, creditIds: manageSelectedIds,
        expiryDate: action === "CHANGE_EXPIRY" ? manageNewExpiry : undefined,
      });
      if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "OIL management operation failed.");
      await Promise.all([
        refreshOilCredits(),
        client.models.Member.list({ limit: 1000 }).then(({ data: memberData, errors: memberErrors }) => {
          if (memberErrors?.length) throw new Error(memberErrors[0].message);
          setMembers([...memberData]);
        }),
      ]);
      setManageSelectedIds([]);
      setMessage(data.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

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

  const bulkOilIssues = useMemo(() => {
    const seen = new Set<string>();
    return bulkOilRows.map(row => {
      const issues: string[] = [];
      const email = row.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push("Invalid email");
      if (!members.some(member => member.email.trim().toLowerCase() === email)) issues.push("No existing member matches this email");
      const amount = Number(row.amount);
      if (!row.amount.trim() || !Number.isFinite(amount) || amount <= 0 ||
          Math.round(amount * 100) !== amount * 100) issues.push("Amount must be positive, max 2 decimals");
      if (!isValidDate(row.expiryDate) || row.expiryDate < singaporeDate()) issues.push("Invalid or expired date");
      const key = [email, row.amount.trim(), row.expiryDate].join("|");
      if (seen.has(key)) issues.push("Duplicate award row");
      seen.add(key);
      return issues;
    });
  }, [bulkOilRows, members]);

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

  function previewBulkOilCsv() {
    try {
      const parsed = parseCsv(bulkOilCsv.replace(/^\uFEFF/, ""));
      const header = parsed.shift()?.map(value => value.trim().toLowerCase()) ?? [];
      const expected = ["email", "amount", "expiry_date"];
      if (header.length !== expected.length || expected.some((value, index) => header[index] !== value)) {
        throw new Error("CSV headers must exactly match: email,amount,expiry_date");
      }
      if (!parsed.length) throw new Error("Add at least one OIL award row.");
      if (parsed.length > 100) throw new Error("Submit a maximum of 100 OIL awards per batch.");
      const previousIds = new Map(bulkOilRows.map(row => [
        [row.email.trim().toLowerCase(), row.amount.trim(), row.expiryDate].join("|"),
        row.requestId,
      ]));
      const nextRows = parsed.map((values, index) => {
        if (values.length !== expected.length) throw new Error(`CSV row ${index + 2} must contain exactly 3 columns.`);
        const email = values[0].trim();
        const amount = values[1].trim();
        const expiryDate = values[2].trim();
        const key = [email.toLowerCase(), amount, expiryDate].join("|");
        return {
          email, amount, expiryDate, line: index + 2,
          requestId: previousIds.get(key) ?? crypto.randomUUID(),
        };
      });
      setBulkOilRows(nextRows);
      setBulkOilResults([]);
      setMessage("Bulk OIL preview ready. Review every row before submitting.");
    } catch (error) {
      setBulkOilRows([]);
      setBulkOilResults([]);
      setMessage(error instanceof Error ? error.message : "Could not preview OIL CSV.");
    }
  }

  async function submitBulkOil() {
    if (!bulkOilRows.length || bulkOilIssues.some(issues => issues.length > 0)) {
      setMessage("Resolve all validation errors before submitting the OIL batch.");
      return;
    }
    setBusy(true);
    setMessage("");
    const reports: string[] = [];
    for (let index = 0; index < bulkOilRows.length; index++) {
      const row = bulkOilRows[index];
      const member = members.find(value => value.email.trim().toLowerCase() === row.email.trim().toLowerCase());
      if (!member) {
        reports.push(`Row ${row.line}: FAILED ${row.email} — member not found`);
        setBulkOilResults([...reports]);
        continue;
      }
      try {
        const { data, errors } = await client.mutations.awardOil({
          memberId: member.id,
          amount: Number(row.amount),
          expiryDate: row.expiryDate,
          requestId: row.requestId,
        });
        if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "Award failed.");
        reports.push(`Row ${row.line}: SUCCESS — ${member.name} (${row.email}), ${row.amount} OIL, expires ${row.expiryDate}`);
        const refreshed = await client.models.Member.get({ id: member.id });
        if (refreshed.data) {
          setMembers(current => current.map(value => value.id === member.id ? refreshed.data as Member : value));
          if (selectedId === member.id) {
            setForm(current => ({
              ...current,
              oil: String(refreshed.data!.oil ?? 0),
              total_leave_balance: String(refreshed.data!.totalLeaveBalance ?? 0),
              total_duties: String(refreshed.data!.totalDuties ?? 0),
            }));
          }
        }
      } catch (error) {
        reports.push(`Row ${row.line}: FAILED ${row.email} — ${error instanceof Error ? error.message : String(error)}`);
      }
      setBulkOilResults([...reports]);
    }
    await refreshOilCredits().catch(() => undefined);
    setBusy(false);
    const failed = reports.filter(report => report.includes(": FAILED")).length;
    setMessage(failed
      ? `Bulk OIL batch finished: ${reports.length - failed} succeeded, ${failed} failed. You can retry the same preview safely; request IDs prevent duplicate awards.`
      : `Bulk OIL batch finished: ${reports.length} awards processed. Re-running this same preview will not add the awards twice.`);
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
      const { data, errors } = await client.mutations.awardOil({
        memberId: awardMemberId,
        amount,
        expiryDate: awardExpiry,
        requestId: crypto.randomUUID(),
      });
      if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "Could not record OIL award.");
      const refreshed = await client.models.Member.get({ id: awardMemberId });
      if (refreshed.data) {
        setMembers(current => current.map(member => member.id === awardMemberId ? refreshed.data as Member : member));
        if (selectedId === awardMemberId) {
          setForm(current => ({
            ...current,
            oil: String(refreshed.data!.oil ?? 0),
            total_leave_balance: String(refreshed.data!.totalLeaveBalance ?? 0),
            total_duties: String(refreshed.data!.totalDuties ?? 0),
          }));
        }
      }
      await refreshOilCredits().catch(() => undefined);
      setAwardAmount("");
      setAwardExpiry("");
      setMessage("OIL award recorded. The individual award and existing leave balance have both been updated.");
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
        oic: addToOic,
      });
      if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "Group update failed.");
      setMessage(addToOic
        ? "Personnel rank, driver and appointment groups updated; OIC group access added."
        : "Personnel rank, driver and appointment groups updated.");
      setAddToOic(false);
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
          <div><h3>Bulk OIL awarding</h3><p>Upload multiple OIL awards at once, with a separate expiry date for every row.</p></div>
        </div>
        <p className="settings-helper">Required CSV headers (in order): <code>email,amount,expiry_date</code></p>
        <p><small>Use the member's existing email address. Amounts can be fractional (for example 1.5). Dates must be today or later in Singapore time. Maximum 100 rows per batch.</small></p>
        <textarea aria-label="Bulk OIL award CSV" rows={7} value={bulkOilCsv} onChange={event => setBulkOilCsv(event.target.value)} placeholder={"email,amount,expiry_date\nmember@example.com,1.5,2026-12-31"} />
        <div className="settings-actions">
          <button className="ghost" type="button" disabled={busy} onClick={previewBulkOilCsv}>Preview and validate CSV</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => {
            setBulkOilRows([]); setBulkOilResults([]); setBulkOilCsv("");
            setMessage("Bulk OIL batch cleared. Previewing a new batch creates new award request IDs.");
          }}>Clear / start new batch</button>
        </div>
        {!!bulkOilRows.length && <>
          <p>{bulkOilRows.length} rows ready for review.</p>
          <div className="settings-table-wrap">
            <table><thead><tr><th>Row</th><th>Email</th><th>Amount</th><th>Expiry date</th><th>Validation</th></tr></thead>
              <tbody>{bulkOilRows.map((row, index) => <tr key={row.requestId}>
                <td>{row.line}</td><td>{row.email}</td><td>{row.amount}</td><td>{row.expiryDate}</td>
                <td>{bulkOilIssues[index].length ? bulkOilIssues[index].join("; ") : "Valid"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="settings-actions">
            <button type="button" disabled={busy || bulkOilIssues.some(issues => issues.length > 0)} onClick={submitBulkOil}>Submit OIL awards</button>
          </div>
        </>}
        {!!bulkOilResults.length && <div className="settings-table-wrap">
          <table><thead><tr><th>Result</th></tr></thead><tbody>
            {bulkOilResults.map((result, index) => <tr key={index}><td>{result}</td></tr>)}
          </tbody></table>
        </div>}
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon" aria-hidden="true">05</span>
          <div><h3>Bulk OIL management</h3><p>Find active awards by expiry date, then change their expiry or void unused awards for multiple personnel.</p></div>
        </div>
        <div className="settings-form-grid">
          <label>Filter by current expiry date
            <select value={manageExpiryFilter} onChange={event => {
              setManageExpiryFilter(event.target.value); setManageSelectedIds([]);
            }}>
              <option value="">All active expiry dates</option>
              {expiryDates.map(date => <option key={date} value={date}>{displayDate(date)}</option>)}
            </select>
          </label>
          <label>New expiry date
            <input type="date" min={singaporeDate()} value={manageNewExpiry} onChange={event => setManageNewExpiry(event.target.value)} />
          </label>
        </div>
        <p><small>Only active, unexpired awards with a remaining balance are shown. Selected remaining OIL: {Math.round(selectedOilTotal * 100) / 100}. Select up to 40 awards per operation.</small></p>
        <div className="settings-actions">
          <button className="ghost" type="button" disabled={busy || !filteredOilCredits.length} onClick={() => setManageSelectedIds(filteredOilCredits.slice(0, 40).map(credit => credit.id))}>Select first 40 shown</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => setManageSelectedIds([])}>Clear selection</button>
          <button type="button" disabled={busy || !manageSelectedIds.length || !manageNewExpiry} onClick={() => manageOil("CHANGE_EXPIRY")}>Change expiry for selected</button>
          <button type="button" disabled={busy || !manageSelectedIds.length} onClick={() => manageOil("VOID")}>Void selected awards</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => refreshOilCredits().then(() => setMessage("OIL award list refreshed.")).catch(error => setMessage(String(error)))}>Refresh awards</button>
        </div>
        <div className="settings-table-wrap">
          <table><thead><tr><th>Select</th><th>Personnel</th><th>Awarded</th><th>Remaining</th><th>Expiry date</th><th>Award date</th></tr></thead>
            <tbody>{filteredOilCredits.map(credit => {
              const member = members.find(value => value.id === credit.memberId);
              return <tr key={credit.id}>
                <td><input aria-label={"Select OIL award for " + (member?.name ?? credit.memberId)} type="checkbox"
                  checked={manageSelectedIds.includes(credit.id)}
                  onChange={event => setManageSelectedIds(current => event.target.checked
                    ? (current.length < 40 ? [...current, credit.id] : current)
                    : current.filter(id => id !== credit.id))} /></td>
                <td>{member ? `${member.rank ?? ""} ${member.name}`.trim() : "Unknown member"}</td>
                <td>{Number(credit.amount ?? 0)}</td><td>{Number(credit.remaining ?? 0)}</td>
                <td>{displayDate(credit.expiryDate)}</td><td>{credit.awardedAt ? displayDate(credit.awardedAt.slice(0, 10)) : "—"}</td>
              </tr>;
            })}{!filteredOilCredits.length && <tr><td colSpan={6}>No active awards match this expiry date.</td></tr>}</tbody>
          </table>
        </div>
        <p><small>Safety note: the current leave flow does not record which individual award funded each OIL deduction. To prevent accidental balance loss, voiding is blocked when a member has an OIL-deducting leave application after that award, or when the award's remaining amount differs from its original amount. Changing expiry remains available.</small></p>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon" aria-hidden="true">06</span>
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
        <p><small>Each award is stored individually and immediately updates the member’s existing OIL and total leave balances.</small></p>
        <div className="settings-actions">
          <button type="button" disabled={busy} onClick={awardOil}>Submit OIL award</button>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><span className="settings-card-icon" aria-hidden="true">07</span><div><h3>Edit personnel record</h3><p>Update personnel details and manage Cognito account roles.</p></div></div>
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
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={addToOic} onChange={e => setAddToOic(e.target.checked)} />
            Add this member to the OIC group
          </label>
          <p><small>Tick this to grant OIC access in addition to the member’s rank. Leaving it unticked will not remove existing OIC membership.</small></p>
          <div className="settings-actions"><button type="button" disabled={busy} onClick={updateGroups}>Save Cognito roles</button></div>
        </div>}
      </section>
    </div>
  );
}

export default function Page() {
  return <Shell><SettingsContent /></Shell>;
}
