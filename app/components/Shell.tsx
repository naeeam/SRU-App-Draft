"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import {
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth";
import { Authenticator } from "@aws-amplify/ui-react";
import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";
import { APPOINTMENTS, KAH_RANKS, LEAVE_TYPES, PAGE_SIZE, RANKS } from "../lib/config";
import { formatDate, formatDateTime } from "../lib/dates";
import "@aws-amplify/ui-react/styles.css";
import "../shell.css";

Amplify.configure(outputs);

export const client = generateClient<Schema>();
export type Leave = Schema["Leave"]["type"];
export type Member = Schema["Member"]["type"];

// Different people with leave covering a date (one entry per person).
export const peopleOn = (leaves: Leave[], date: string, statuses: string[]) => {
  const seen = new Set<string>();
  return leaves.filter((l) => {
    if (!statuses.includes(l.status ?? "PENDING")) return false;
    if (l.startDate > date || l.endDate < date) return false;
    const who = l.owner ?? l.id;
    if (seen.has(who)) return false;
    seen.add(who);
    return true;
  });
};

type App = {
  email: string;
  name: string;
  isDriver: boolean;
  isOIC: boolean;
  appointment: string;
  role: string;
  isApprover: boolean;
  leaves: Leave[];
  isMine: (l: Leave) => boolean;
};
const AppCtx = createContext<App | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1); // stays valid when items are removed
  const start = current * PAGE_SIZE;
  return {
    items: items.slice(start, start + PAGE_SIZE),
    page: current,
    pages,
    setPage,
    from: start + 1,
    to: Math.min(start + PAGE_SIZE, items.length),
    total: items.length,
  };
}

export function Pager({ paged }: { paged: ReturnType<typeof usePaged> }) {
  if (paged.pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        className="ghost"
        disabled={paged.page === 0}
        onClick={() => paged.setPage(paged.page - 1)}
      >
        ‹ Previous
      </button>
      <small>
        Page {paged.page + 1} of {paged.pages} · {paged.from}–{paged.to} of {paged.total}
      </small>
      <button
        className="ghost"
        disabled={paged.page >= paged.pages - 1}
        onClick={() => paged.setPage(paged.page + 1)}
      >
        Next ›
      </button>
    </nav>
  );
}

function useLeaves() {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  useEffect(() => {
    const sub = client.models.Leave.observeQuery().subscribe({
      next: ({ items }) =>
        setLeaves(
          items
            .filter((i) => i && i.startDate && i.endDate) // skip broken/old records
            .map((i) => ({ ...i, status: i.status ?? "PENDING" }))
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
        ),
      error: (e) => console.error("Leave data error:", e),
    });
    return () => sub.unsubscribe();
  }, []);
  return leaves;
}

export function LeaveRow({ l, children }: { l: Leave; children?: React.ReactNode }) {
  return (
    <li>
      <div>
        <strong>{l.applicantName}</strong>{" "}
        <small>· {LEAVE_TYPES.find(([v]) => v === l.leaveType)?.[1]}</small>
        <div>
          {formatDateTime(l.startDate, l.startTime)} to {formatDateTime(l.endDate, l.endTime)}
        </div>
        {l.reason && <small>{l.reason}</small>}
        {l.reviewedBy && (
          <div>
            <small>Reviewed by {l.reviewedBy}</small>
          </div>
        )}
      </div>
      <div className="acts">
        <span className={`tag ${l.status}`}>
          {l.status === "PENDING" ? "Pending" : l.status === "APPROVED" ? "Approved" : "Rejected"}
        </span>
        {children}
      </div>
    </li>
  );
}

function Frame({
  signOut,
  children,
}: {
  signOut?: () => void;
  children: React.ReactNode;
}) {
  const [me, setMe] = useState<{
    email: string;
    name: string;
    isDriver: boolean;
    isOIC: boolean;
    appointment: string;
    userId: string;
    role: string;
    isApprover: boolean;
  } | null>(null);
  const leaves = useLeaves();
  const path = usePathname();

  useEffect(() => {
    (async () => {
      const [session, attrs, user] = await Promise.all([
        fetchAuthSession(),
        fetchUserAttributes(),
        getCurrentUser(),
      ]);
      const groups =
        (session.tokens?.accessToken.payload["cognito:groups"] as string[]) ?? [];
      setMe({
        email: attrs.email ?? "",
        name: attrs.name ?? "",
        isDriver: groups.includes("DRIVER"),
        isOIC: groups.includes("OIC"),
        appointment: APPOINTMENTS.find((a) => groups.includes(`APPT_${a}`)) ?? "",
        userId: user.userId,
        role: RANKS.find((r) => groups.includes(r)) ?? "Unassigned",
        isApprover: KAH_RANKS.some((r) => groups.includes(r)),
      });
    })();
  }, []);

  if (!me)
    return (
      <div className="lv">
        <p className="loading" role="status">
          Loading…
        </p>
      </div>
    );

  const isMine = (l: Leave) => !!l.owner && l.owner.startsWith(me.userId);
  const pendingCount = me.isApprover
    ? leaves.filter((l) => l.status === "PENDING").length
    : 0;

  const link = (href: string, label: React.ReactNode) => (
    <Link href={href} aria-current={path === href ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <AppCtx.Provider
      value={{
        email: me.email,
        name: me.name,
        isDriver: me.isDriver,
        isOIC: me.isOIC,
        appointment: me.appointment,
        role: me.role,
        isApprover: me.isApprover,
        leaves,
        isMine,
      }}
    >
      <div className="lv">
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <header>
          <div className="brand">
            <span className="mark" aria-hidden="true">
              R3E
            </span>
            <div>
              <h1>Management Hub</h1>
              <small>
                {me.role}
                {me.isApprover ? " (KAH)" : ""} {me.name || me.email}
                {me.appointment ? ` · ${me.appointment}` : ""}
                {me.isDriver ? " · Driver" : ""}
                {me.isOIC ? " · OIC" : ""}
              </small>
            </div>
          </div>
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
        </header>

        <nav aria-label="Primary">
          {link("/", "Dashboard")}
          {link("/my-leave", "My leave")}
          {link("/apply", "Apply for leave")}
          {me.isApprover &&
            link(
              "/approvals",
              <>
                Approvals
                {pendingCount > 0 && (
                  <>
                    <span className="badge" aria-hidden="true">
                      {pendingCount}
                    </span>
                    <span className="sr-only">, {pendingCount} pending</span>
                  </>
                )}
              </>
            )}
          {(me.isApprover || me.isOIC) && link("/leave-balance", "Leave Balance")}
          {link("/members", "My Info")}
        </nav>

        <main className="content" id="main">
          {children}
        </main>
      </div>
    </AppCtx.Provider>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Authenticator hideSignUp>
      {({ signOut }) => <Frame signOut={signOut}>{children}</Frame>}
    </Authenticator>
  );
}