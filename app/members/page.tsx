"use client";

import { useEffect, useState } from "react";
import { fetchUserAttributes } from "aws-amplify/auth";
import type { Schema } from "@/amplify/data/resource";
import Shell, { client, useApp } from "../components/Shell";

type Member = Schema["Member"]["type"];

// Whole numbers show as they are; halves and quarters keep their decimals.
const show = (n: number | null | undefined) => String(Math.round((n ?? 0) * 100) / 100);

// +6596751705 -> +65 9675 1705
const showPhone = (p: string) => p.replace(/^\+65(\d{4})(\d{4})$/, "+65 $1 $2");

function MyInfo() {
  const { email, name, role, isApprover, isDriver, appointment } = useApp();
  const [phone, setPhone] = useState("");
  // undefined = still loading, null = no balance record for this account
  const [row, setRow] = useState<Member | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUserAttributes()
      .then((a) => setPhone(a.phone_number ?? ""))
      .catch(() => setPhone(""));
  }, []);

  // Only the signed-in person's own row, matched by login email (stored in lowercase).
  useEffect(() => {
    const sub = client.models.Member.observeQuery({
      filter: { email: { eq: email.toLowerCase() } },
    }).subscribe({
      next: ({ items }) => setRow(items[0] ?? null),
      error: (e) => {
        console.error("My info data error:", e);
        setError("Could not load your leave balances. Please try again later.");
        setRow(null);
      },
    });
    return () => sub.unsubscribe();
  }, [email]);

  const info: [string, string][] = [
    ["Name", name || email],
    ["Rank", isApprover ? `${role} (KAH)` : role],
    ["Appointment", appointment || "Not set"],
    ["Driver", isDriver ? "Yes" : "No"],
    ["Email", email],
    ["Phone number", phone ? showPhone(phone) : "Not set"],
  ];

  const al = row?.al ?? 0;
  const oil = row?.oil ?? 0;
  const phol = row?.phol ?? 0;
  const balances: [string, string][] = row
    ? [
        ["MC count", show(row.mcCount)],
        ["AL", show(al)],
        ["OIL", show(oil)],
        ["PHOL", show(phol)],
        ["Total Leave Balance", show(row.totalLeaveBalance ?? al + oil + phol)],
        ["Duties", show(row.totalDuties ?? (al + oil + phol) / 2)],
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
      {error && (
        <p role="alert" style={{ color: "#8c1d18" }}>
          {error}
        </p>
      )}
      {row === undefined ? (
        <small>Loading…</small>
      ) : row === null ? (
        !error && <small>No leave balances have been set up for your account yet. Please ask your KAH.</small>
      ) : (
        <div className="stats">
          {balances.map(([label, value]) => (
            <div className="stat" key={label}>
              <b>{value}</b>
              {label}
            </div>
          ))}
        </div>
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