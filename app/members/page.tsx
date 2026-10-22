"use client";

import { useEffect, useState } from "react";
import { fetchUserAttributes } from "aws-amplify/auth";
import Shell, { useApp } from "../components/Shell";
import { totalsOf } from "../lib/Balance";
import { balanceOf } from "../lib/Balanceactions";
import { useMyMember } from "../lib/Usemymember";

const show = (n: number | null | undefined) =>
  String(Math.round((n ?? 0) * 100) / 100);
const showPhone = (p: string) =>
  p.replace(/^\+65(\d{4})(\d{4})$/, "+65 $1 $2");

function MyInfo() {
  const { email, name, role, isApprover, isDriver, appointment } = useApp();
  const { row, error } = useMyMember();
  const [phone, setPhone] = useState("");

  useEffect(() => {
    fetchUserAttributes()
      .then((attrs) => setPhone(attrs.phone_number ?? ""))
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

  const balance = row ? balanceOf(row) : null;
  const balances: [string, string][] =
    row && balance
      ? [
          ["MC count", show(row.mcCount)],
          ["AL", show(balance.al)],
          ["OIL", show(balance.oil)],
          ["PHOL", show(balance.phol)],
          ["Total Leave Balance", show(row.totalLeaveBalance ?? totalsOf(balance).totalLeaveBalance)],
          ["Duties", show(row.totalDuties ?? totalsOf(balance).totalDuties)],
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
      {error && <p role="alert" style={{ color: "#8c1d18" }}>{error}</p>}
      {row === undefined ? (
        <small>Loading…</small>
      ) : row === null ? (
        !error && <small>No leave balances have been set up for your account yet. Please ask your KAH.</small>
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
            <small>For balance corrections, please contact your KAH.</small>
          </p>
        </>
      )}
    </>
  );
}

export default function Page() {
  return <Shell><MyInfo /></Shell>;
}
