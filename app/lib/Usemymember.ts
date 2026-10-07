"use client";

import { useEffect, useState } from "react";
import { client, useApp, type Member } from "../components/Shell";

// The signed-in person's own balance row, matched by login email (stored in lowercase).
// row: undefined while loading, null when there is no row for this account.
export function useMyMember() {
  const { email } = useApp();
  const [row, setRow] = useState<Member | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    const sub = client.models.Member.observeQuery({
      filter: { email: { eq: email.toLowerCase() } },
    }).subscribe({
      next: ({ items }) => setRow(items[0] ?? null),
      error: (e) => {
        console.error("My balance data error:", e);
        const err = e as { errors?: { message: string }[]; message?: string };
        setError(`Could not load your leave balances. ${err?.errors?.[0]?.message ?? err?.message ?? ""}`.trim());
        setRow(null);
      },
    });
    return () => sub.unsubscribe();
  }, [email]);

  return { row, error };
}