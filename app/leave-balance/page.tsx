"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import type { Schema } from "@/amplify/data/resource";
import Shell, { client } from "../components/Shell";

type Member = Schema["Member"]["type"];

// Groups that may open this page: the KAH ranks and the OIC admin role.
const ALLOWED = ["LTA", "WO2", "OIC"];
// Highest to lowest. SGT2 ranks above SGT1.
const RANK_ORDER = ["LTA", "WO2", "SGT2", "SGT1", "CPL", "LCP"];

// Whole numbers show as they are; halves and quarters keep their decimals.
const show = (n: number | null | undefined) => String(Math.round((n ?? 0) * 100) / 100);
const rankIndex = (r?: string | null) => {
  const i = RANK_ORDER.indexOf(r ?? "");
  return i === -1 ? RANK_ORDER.length : i;
};

type SortKey = "rank" | "name" | "al" | "oil" | "phol" | "total" | "duties" | "mc";
type Row = { m: Member; al: number; oil: number; phol: number; total: number; duties: number; mc: number };

const COLUMNS: [SortKey, string][] = [
  ["rank", "Rank"],
  ["name", "Full name"],
  ["al", "AL"],
  ["oil", "OIL"],
  ["phol", "PHOL"],
  ["total", "Total Leave Balance"],
  ["duties", "Total Duties"],
  ["mc", "MC count"],
];

const SORT_OPTIONS: [string, string][] = [
  ["rank:asc", "Rank: highest first"],
  ["rank:desc", "Rank: lowest first"],
  ["name:asc", "Name: A to Z"],
  ["name:desc", "Name: Z to A"],
  ["total:desc", "Leave left: most to least"],
  ["total:asc", "Leave left: least to most"],
  ["mc:desc", "MC count: most to least"],
  ["mc:asc", "MC count: least to most"],
];

function LeaveBalanceList() {
  const [allowed, setAllowed] = useState<boolean | null>(null); // null = checking
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [rankFilter, setRankFilter] = useState("ALL");
  const [balanceFilter, setBalanceFilter] = useState("ALL"); // ALL, HAS, NONE
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    fetchAuthSession()
      .then((s) => {
        const groups = (s.tokens?.accessToken.payload["cognito:groups"] as string[]) ?? [];
        setAllowed(ALLOWED.some((g) => groups.includes(g)));
      })
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const sub = client.models.Member.observeQuery().subscribe({
      next: ({ items }) => setMembers(items.filter((i) => !!i && !!i.name)),
      error: (e) => {
        console.error("Leave balance data error:", e);
        const err = e as { errors?: { message: string }[]; message?: string };
        const why = err?.errors?.[0]?.message ?? err?.message ?? "";
        setError(`Could not load the leave balances. ${why}`.trim());
      },
    });
    return () => sub.unsubscribe();
  }, [allowed]);

  // Work out each person's figures once, then search, filter and sort.
  const rows = useMemo(() => {
    const all: Row[] = members.map((m) => {
      const al = m.al ?? 0;
      const oil = m.oil ?? 0;
      const phol = m.phol ?? 0;
      const sum = al + oil + phol;
      return { m, al, oil, phol, total: m.totalLeaveBalance ?? sum, duties: m.totalDuties ?? sum / 2, mc: m.mcCount ?? 0 };
    });

    const q = search.trim().toLowerCase();
    const filtered = all.filter(({ m, total }) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (rankFilter === "NONE" ? !!m.rank : rankFilter !== "ALL" && m.rank !== rankFilter) return false;
      if (balanceFilter === "HAS" && total <= 0) return false;
      if (balanceFilter === "NONE" && total > 0) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: Row, b: Row) => a.m.name.localeCompare(b.m.name);
    return filtered.sort((a, b) => {
      let diff = 0;
      if (sortKey === "rank") diff = rankIndex(a.m.rank) - rankIndex(b.m.rank);
      else if (sortKey === "name") diff = byName(a, b);
      else diff = a[sortKey] - b[sortKey];
      return diff * dir || byName(a, b);
    });
  }, [members, search, rankFilter, balanceFilter, sortKey, sortDir]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      // Numbers start with the biggest first; rank and name start at the top of the list.
      setSortDir(key === "rank" || key === "name" ? "asc" : "desc");
    }
  }

  const filtersOn = search !== "" || rankFilter !== "ALL" || balanceFilter !== "ALL";
  function reset() {
    setSearch("");
    setRankFilter("ALL");
    setBalanceFilter("ALL");
    setSortKey("rank");
    setSortDir("asc");
  }

  if (allowed === null) return <small>Loading…</small>;
  if (!allowed) return <p>Only Key Appointment Holders (LTA, WO2) and the OIC can view the leave balances.</p>;

  return (
    <>
      <h2>Leave Balance</h2>
      {error && (
        <p role="alert" style={{ color: "#8c1d18" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label style={{ flex: "1 1 200px" }}>
          Search
          <input
            type="search"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Sort by
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":");
              setSortKey(k as SortKey);
              setSortDir(d as "asc" | "desc");
            }}
          >
            {!SORT_OPTIONS.some(([v]) => v === `${sortKey}:${sortDir}`) && (
              <option value={`${sortKey}:${sortDir}`}>By column heading</option>
            )}
            {SORT_OPTIONS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter by balance
          <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)}>
            <option value="ALL">Any balance</option>
            <option value="HAS">Has leave left</option>
            <option value="NONE">No leave left</option>
          </select>
        </label>
        <button type="button" className="ghost" onClick={reset} disabled={!filtersOn && sortKey === "rank" && sortDir === "asc"}>
          Reset
        </button>
      </div>

      <small aria-live="polite">
        Showing {rows.length} of {members.length}
      </small>

      {members.length === 0 && !error ? (
        <p>
          <small>No leave balances have been added yet.</small>
        </p>
      ) : rows.length === 0 ? (
        <p>
          <small>No one matches these filters.</small>
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 10 }} tabIndex={0} role="region" aria-label="Leave balances">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(([key, label]) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(key)}
                      title={`Sort by ${label}`}
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        color: "inherit",
                        font: "inherit",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, al, oil, phol, total, duties, mc }) => (
                <tr key={m.id}>
                  <td>{m.rank || "Not set"}</td>
                  <td>{m.name}</td>
                  <td>{show(al)}</td>
                  <td>{show(oil)}</td>
                  <td>{show(phol)}</td>
                  <td>{show(total)}</td>
                  <td>{show(duties)}</td>
                  <td>{mc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <LeaveBalanceList />
    </Shell>
  );
}