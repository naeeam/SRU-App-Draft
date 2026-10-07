"use client";

import { useEffect, useState } from "react";
import { fetchUserAttributes } from "aws-amplify/auth";
import Shell, { useApp } from "../components/Shell";
import { totalsOf, type Balance } from "../lib/Balance";
import { balanceOf, saveBalance } from "../lib/Balanceactions";
import { useMyMember } from "../lib/Usemymember";

// Whole numbers show as they are; halves and quarters keep their decimals.
const show = (n: number | null | undefined) => String(Math.round((n ?? 0) * 100) / 100);

// +6596751705 -> +65 9675 1705
const showPhone = (p: string) => p.replace(/^\+65(\d{4})(\d{4})$/, "+65 $1 $2");

const FIELDS: { key: keyof Balance; label: string }[] = [
  { key: "al", label: "AL" },
  { key: "oil", label: "OIL" },
  { key: "phol", label: "PHOL" },
];

function MyInfo() {
  const { email, name, role, isApprover, isDriver, appointment } = useApp();
  const { row, error: loadError } = useMyMember();
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<keyof Balance, string>>({ al: "0", oil: "0", phol: "0" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUserAttributes()
      .then((a) => setPhone(a.phone_number ?? ""))
      .catch(() => setPhone(""));
  }, []);

  const info: [string, string][] = [
    ["Name", name || email],
    ["Rank", isApprover ? `${role} (KAH)` : role],
    ["Appointment", appointment || "Not set"],
    ["Driver", isDriver ? "Yes" : "No"],
    ["Email", email],
    ["Phone number", phone ? showPhone(phone) : "Not set"],
  ];

  // What the draft would save. null means one of the boxes is not a valid number.
  const parsed = (): Balance | null => {
    const out = {} as Balance;
    for (const f of FIELDS) {
      const v = Number(draft[f.key]);
      if (draft[f.key].trim() === "" || !Number.isFinite(v) || v < 0 || v > 999) return null;
      out[f.key] = Math.round(v * 100) / 100;
    }
    return out;
  };
  const preview = parsed();

  function startEdit() {
    if (!row) return;
    const b = balanceOf(row);
    setDraft({ al: String(b.al), oil: String(b.oil), phol: String(b.phol) });
    setMessage("");
    setError("");
    setEditing(true);
  }

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!row || !preview) return;
    setSaving(true);
    setError("");
    try {
      const { errors } = await saveBalance(row.id, preview);
      if (errors) {
        setError(
          row.userId
            ? `Could not save: ${errors[0].message}`
            : "Could not save. Your account is not linked to this record yet. Please ask your KAH to update it."
        );
        return;
      }
      setEditing(false);
      setMessage("Your leave balances were saved.");
    } catch (err) {
      console.error("Saving balances failed:", err);
      setError("Something went wrong while saving. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const b = row ? balanceOf(row) : null;
  const balances: [string, string][] =
    row && b
      ? [
        ["MC count", show(row.mcCount)],
        ["AL", show(b.al)],
        ["OIL", show(b.oil)],
        ["PHOL", show(b.phol)],
        ["Total Leave Balance", show(row.totalLeaveBalance ?? totalsOf(b).totalLeaveBalance)],
        ["Duties", show(row.totalDuties ?? totalsOf(b).totalDuties)],
      ]
      : [];

  return (
    <>
      <h2>My info</h2>
      <ul>
        {info.map(([label, value]) => (
          <li key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>

      <h2>My leave balances</h2>
      {(loadError || error) && (
        <p role="alert" style={{ color: "#8c1d18" }}>
          {error || loadError}
        </p>
      )}
      {message && (
        <p role="status" style={{ color: "#14532d" }}>
          {message}
        </p>
      )}

      {row === undefined ? (
        <small>Loading…</small>
      ) : row === null ? (
        !loadError && <small>No leave balances have been set up for your account yet. Please ask your KAH.</small>
      ) : editing ? (
        <form onSubmit={save}>
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label} (days)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={999}
                step={0.5}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                required
              />
            </label>
          ))}
          <p className="full">
            <small>
              {preview
                ? `Total Leave Balance ${show(totalsOf(preview).totalLeaveBalance)} · Duties ${show(totalsOf(preview).totalDuties)}`
                : "Enter a number from 0 to 999 in each box."}
            </small>
          </p>
          <div className="full acts">
            <button type="submit" disabled={saving || !preview}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="stats">
            {balances.map(([label, value]) => (
              <div className="stat" key={label}>
                <b>{value}</b>
                {label}
              </div>
            ))}
          </div>
          <p className="full" style={{ padding: "12px 0" }}>
            <button className="ghost" onClick={startEdit}>
              Edit AL, OIL and PHOL
            </button>
          </p>
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <MyInfo />
    </Shell>
  );
}