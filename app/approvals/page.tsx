"use client";

import { useEffect, useState } from "react";
import Shell, {
  LeaveRow,
  Pager,
  client,
  peopleOn,
  useApp,
  usePaged,
  type Leave,
} from "../components/Shell";
import { MAX_LEAVE_PER_DUTY_DAY } from "../lib/config";
import { dutyDaysBetween, formatDate } from "../lib/dates";
import { getUrl } from "aws-amplify/storage"; // 👈 Import storage getUrl API
import { pathToFileURL } from "url";

type Status = "APPROVED" | "REJECTED" | "PENDING";

// Helper component to handle generating and rendering a secure view link for a screenshot
function ScreenshotLink({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!path) {
    return <span style={{ color: "#d9534f", fontSize: "0.85rem", marginRight: "10px" }}>No screenshot</span>;
  }

  async function openScreenshot() {
    if (url) {
      window.open(url, "_blank");
      return;
    }
    setLoading(true);
    try {
      const result = await getUrl({
        path: path!,
        options: {
          expiresIn: 300,
          bucket: "leaveWorkflowStorage",
        },
      });

      const finalUrl = result.url.toString();
      setUrl(finalUrl);
      window.open(finalUrl, "_blank");
    } catch (err) {
      console.error("Failed to load screenshot url", err);
      alert("Could not load screenshot file.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="ghost" onClick={openScreenshot} disabled={loading} style={{ marginRight: "10px" }}>
      {loading ? "Loading..." : "View screenshot 📷"}
    </button>
  );
}

function Approvals() {
  const { isApprover } = useApp();
  if (!isApprover) return <p className="empty">Only Key Appointment Holders (LTA, WO2) can view approvals.</p>;
  return <ApprovalsList />;
}

function ApprovalsList() {
  const { leaves: serverLeaves, role, email } = useApp();
  const [error, setError] = useState("");
  const [local, setLocal] = useState<Record<string, Partial<Leave>>>({});

  useEffect(() => {
    setLocal((m) => {
      const next = { ...m };
      let changed = false;
      for (const id of Object.keys(m)) {
        const sv = serverLeaves.find((l) => l.id === id);
        if (sv && sv.status === m[id].status) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [serverLeaves]);

  const leaves = serverLeaves.map((l) => (local[l.id] ? { ...l, ...local[l.id] } : l));

  const pending = leaves
    .filter((l) => l.status === "PENDING")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const decided = leaves
    .filter((l) => l.status !== "PENDING")
    .sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
  const pendingPaged = usePaged(pending);
  const decidedPaged = usePaged(decided);
  const count = (s: string) => leaves.filter((l) => l.status === s).length;

  async function review(l: Leave, status: Status) {
    setError("");

    if (l.status === "REJECTED" && status !== "REJECTED") {
      const others = leaves.filter((x) => x.id !== l.id && x.owner !== l.owner);
      const full = dutyDaysBetween(l.startDate, l.endDate).filter(
        (d) => peopleOn(others, d, ["PENDING", "APPROVED"]).length >= MAX_LEAVE_PER_DUTY_DAY
      );
      if (
        full.length &&
        !window.confirm(
          `${MAX_LEAVE_PER_DUTY_DAY} people are already away on ${full.map(formatDate).join(", ")}. Continue anyway?`
        )
      )
        return;
    }

    const before = { status: l.status, reviewedBy: l.reviewedBy };
    const decision =
      status === "PENDING"
        ? { status, reviewedBy: "" }
        : { status, reviewedBy: `${role} ${email}`, reviewedAt: new Date().toISOString() };

    setLocal((m) => ({ ...m, [l.id]: decision }));
    const { errors } = await client.models.Leave.update({ id: l.id, ...decision });
    if (errors) {
      setLocal((m) => ({ ...m, [l.id]: before }));
      setError(errors[0].message);
    }
  }

  return (
    <>
      <h2>Approvals</h2>
      <div className="stats">
        <div className="stat warn"><b>{count("PENDING")}</b>Pending</div>
        <div className="stat ok"><b>{count("APPROVED")}</b>Approved</div>
        <div className="stat no"><b>{count("REJECTED")}</b>Rejected</div>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <h2>Waiting for your decision</h2>
      {pending.length === 0 ? (
        <p className="empty">No pending requests.</p>
      ) : (
        <>
          <ul>
            {pendingPaged.items.map((l) => (
              <LeaveRow key={l.id} l={l}>
                {/* Screenshot status / view button */}
                <ScreenshotLink path={l.screenshotPath} />

                <button className="ok" onClick={() => review(l, "APPROVED")}>
                  Approve
                </button>
                <button className="ghost" onClick={() => review(l, "REJECTED")}>
                  Reject
                </button>
              </LeaveRow>
            ))}
          </ul>
          <Pager paged={pendingPaged} />
        </>
      )}

      <h2>Recently Approved/Rejected</h2>
      {decided.length === 0 ? (
        <p className="empty">Nothing approved or rejected yet.</p>
      ) : (
        <>
          <ul>
            {decidedPaged.items.map((l) => (
              <LeaveRow key={l.id} l={l}>
                {/* Screenshot status / view button */}
                <ScreenshotLink path={l.screenshotPath} />

                {l.status === "APPROVED" ? (
                  <button className="ghost" onClick={() => review(l, "REJECTED")}>
                    Reject
                  </button>
                ) : (
                  <button className="ok" onClick={() => review(l, "APPROVED")}>
                    Approve
                  </button>
                )}
                <button className="ghost" onClick={() => review(l, "PENDING")}>
                  Back to pending
                </button>
              </LeaveRow>
            ))}
          </ul>
          <Pager paged={decidedPaged} />
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <Approvals />
    </Shell>
  );
}