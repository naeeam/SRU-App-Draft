"use client";

import { useEffect, useState } from "react";
import { fetchUserAttributes } from "aws-amplify/auth";
import Shell, { client, useApp } from "../components/Shell";
import { singaporeDate } from "../lib/OilExpiry";
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
  const [oilAwards, setOilAwards] = useState<{ id: string; amount: number; remaining: number; expiryDate: string; voidedAt?: string | null }[]>([]);
  const [oilLoading, setOilLoading] = useState(false);
  const [oilError, setOilError] = useState("");
  const [today, setToday] = useState(() => singaporeDate());

  useEffect(() => {
    const timer = setInterval(() => setToday(singaporeDate()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!row?.id) {
      setOilAwards([]);
      return;
    }
    let active = true;
    setOilLoading(true);
    setOilError("");
    setOilAwards([]);
    (async () => {
      try {
        const awards: { id: string; amount: number; remaining: number; expiryDate: string; voidedAt?: string | null }[] = [];
        let nextToken: string | null | undefined;
        do {
          const page = await client.models.OilCredit.listOilCreditByMemberId(
            { memberId: row.id }, { limit: 100, nextToken }
          );
          if (page.errors?.length) throw new Error(page.errors[0].message);
          awards.push(...page.data.map(credit => ({
            id: credit.id, amount: credit.amount,
            remaining: credit.remaining, expiryDate: credit.expiryDate,
            voidedAt: credit.voidedAt,
          })));
          nextToken = page.nextToken;
        } while (nextToken);
        if (active) setOilAwards(awards.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)));
      } catch (err) {
        if (active) setOilError(err instanceof Error ? err.message : "Unable to load OIL awards.");
      } finally {
        if (active) setOilLoading(false);
      }
    })();
    return () => { active = false; };
  }, [row?.id]);

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
          <section className="full" aria-label="Individual OIL awards" style={{ padding: "12px 0" }}>
            <h2>My OIL awards and expiry dates</h2>
            <p><small>Each OIL award expires after its listed date (Singapore time). Expired awards cannot fund new leave applications.</small></p>
            {oilLoading ? <p>Loading OIL awards…</p> : oilError ? (
              <p role="alert">{oilError}</p>
            ) : oilAwards.length === 0 ? (
              <p>No individual OIL awards have been recorded yet. Any existing OIL shown above is a legacy balance without individual expiry records.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th scope="col">OIL awarded</th><th scope="col">Remaining</th><th scope="col">Expiry date</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {oilAwards.map(credit => {
                      const voided = Boolean(credit.voidedAt);
                      const expired = credit.expiryDate < today;
                      const status = voided ? "Voided" : expired ? "Expired" : credit.remaining <= 0 ? "Fully used" : "Available";
                      return (
                        <tr key={credit.id}>
                          <td>{show(credit.amount)}</td>
                          <td>{show(voided || expired ? 0 : credit.remaining)}</td>
                          <td>{credit.expiryDate}</td>
                          <td>{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p><small>The OIL balance above is the existing member balance. The award records are shown separately until the expiry ledger is integrated with leave deductions.</small></p>
          </section>
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
