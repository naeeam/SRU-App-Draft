"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Shell, { LeaveRow, Pager, client, useApp, usePaged, type Leave } from "../components/Shell";
import { formatDate } from "../lib/dates";
import { remove, uploadData } from "aws-amplify/storage";

function MyLeave() {
  const { leaves, isMine } = useApp();
  const router = useRouter();
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState<string[]>([]); // hidden right away
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const mine = leaves.filter((l) => isMine(l) && !cancelled.includes(l.id));
  const paged = usePaged(mine);

  async function cancel(l: Leave) {
    if (!window.confirm(`Cancel your request for ${formatDate(l.startDate)} to ${formatDate(l.endDate)}?`)) return;
    setError("");
    setCancelled((c) => [...c, l.id]);

    try {
      const { errors } = await client.models.Leave.delete({ id: l.id });
      if (errors) throw new Error(errors[0].message);

      // Only remove the screenshot once the request is really gone.
      if (l.screenshotPath) {
        try {
          await remove({ path: l.screenshotPath, options: { bucket: "leaveWorkflowStorage" } });
        } catch (e) {
          console.error("Screenshot not removed:", e);
        }
      }
    } catch (err: any) {
      setCancelled((c) => c.filter((id) => id !== l.id));
      setError(`Could not cancel: ${err.message || "Unknown error"}`);
    }
  }

  async function handleUpload(l: Leave, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploadingId(l.id);

    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const datePart = l.startDate === l.endDate ? l.startDate : `${l.startDate}_to_${l.endDate}`;
      const customFileName = `${l.applicantName}_${datePart}.${fileExt}`.replace(/\s+/g, "_");
      const filePath = `screenshots/${l.id}/${customFileName}`;

      // 1. Upload to S3 with the new customized filename
      await uploadData({
        path: filePath,
        data: file,
        options: { bucket: "leaveWorkflowStorage" },
      }).result;

      // 2. Update DynamoDB record with the screenshot path
      const { errors } = await client.models.Leave.update({
        id: l.id,
        screenshotPath: filePath,
      });

      if (errors) throw new Error(errors[0].message);

      // 3. Refresh data
      router.refresh();
    } catch (err: any) {
      setError(`Failed to upload screenshot: ${err.message}`);
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <>
      <h2>My leave requests</h2>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {mine.length === 0 ? (
        <p className="empty">
          You haven&apos;t applied for any leave yet. <Link href="/apply">Apply for leave</Link>
        </p>
      ) : (
        <>
          <ul>
            {paged.items.map((l) => (
              <LeaveRow key={l.id} l={l}>
                {/* Upload Link if screenshot is missing */}
                {!l.screenshotPath && (
                  <label className="ghost" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", marginRight: "10px" }}>
                    {uploadingId === l.id ? "Uploading..." : "Upload workpal screenshot"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => handleUpload(l, e)}
                      disabled={uploadingId === l.id}
                    />
                  </label>
                )}

                {/* Cancel Request Button */}
                {l.status === "PENDING" && (
                  <button className="ghost" onClick={() => cancel(l)}>
                    Cancel request
                  </button>
                )}
              </LeaveRow>
            ))}
          </ul>
          <Pager paged={paged} />
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <MyLeave />
    </Shell>
  );
}