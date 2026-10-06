"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadData } from "aws-amplify/storage";
import DutyDatePicker from "../components/Dutydatepicker";
import Shell, { client, peopleOn, useApp, type Leave } from "../components/Shell";
import {
  APPOINTMENT_LIMITS,
  DRIVER_LIMIT,
  DUTY_START_TIME,
  LEAVE_TYPES,
  MAX_LEAVE_PER_DUTY_DAY,
  ROTA_STRENGTH,
} from "../lib/config";
import {
  addDays,
  dutyDaysBetween,
  formatDate,
  isDutyDay,
  nextDutyDay,
} from "../lib/dates";

import SingleFileUploader from "../components/Fileuploader";

const fmt = formatDate;

function ApplyForm() {
  const { email, name, role, isDriver, appointment, leaves, isMine } = useApp();
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA");

  // Shown as e.g. "SGT1 Ahmad Tan". Comes from the account, so it is not typed in.
  const applicantName = name ? (role === "Unassigned" ? name : `${role} ${name}`) : email;

  const [leaveType, setLeaveType] = useState("VACATION");
  const [startDate, setStartDate] = useState(() => nextDutyDay(today));
  const [endDate, setEndDate] = useState(() => nextDutyDay(today));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null); // State for the optional file
  const isTimeOff = leaveType === "TIME_OFF";



  // Duty runs 0900 to 0900, so time off can end on the duty date or the day after, no later.
  const latestTimeOffEnd = addDays(startDate, 1);


  const check = useMemo(() => {
    const problems: string[] = []; // hard rules: block submitting
    const warnings: string[] = []; // guidelines: shown, but the request can still be submitted
    const rangeOk = !!startDate && !!endDate && endDate >= startDate;
    if (!rangeOk) problems.push("End date must be on or after the start date.");
    if (isTimeOff) {
      if (rangeOk && endDate > latestTimeOffEnd)
        problems.push("Time off can end at most 1 day after the duty date.");
      if (!startTime || !endTime) problems.push("Enter the start and end time for your time off.");
      else if (startDate === endDate && endTime <= startTime)
        problems.push("End time must be after the start time.");
    }

    const days = rangeOk ? dutyDaysBetween(startDate, endDate) : [];
    const active = ["PENDING", "APPROVED"];
    const covers = (l: Leave, d: string) => l.startDate <= d && l.endDate >= d;

    // Time off is separate from manpower: it is not counted in Away, Available,
    // Drivers or appointments, and it is never blocked by the limit of 5.
    const manpower = leaves.filter((l) => l.leaveType !== "TIME_OFF");
    const counts = !isTimeOff; // does this request count towards manpower?

    // Everyone's leave counts, including yours. The new request adds 1 only if you
    // aren't already counted in that group on that day.
    const after = (
      d: string,
      statuses: string[],
      pred: (l: Leave) => boolean,
      applicantMatches: boolean
    ) => {
      const inGroup = manpower.filter(pred);
      const already = inGroup.some(
        (l) => isMine(l) && statuses.includes(l.status ?? "PENDING") && covers(l, d)
      );
      return peopleOn(inGroup, d, statuses).length + (applicantMatches && !already ? 1 : 0);
    };

    let available = ROTA_STRENGTH;
    let away = 0;
    let drivers = 0;
    let vl = 0;
    let ovl = 0;
    const byAppt: Record<string, number> = Object.fromEntries(
      Object.keys(APPOINTMENT_LIMITS).map((k) => [k, 0])
    );

    for (const d of days) {
      const mineOverlap = leaves.some(
        (l) => isMine(l) && active.includes(l.status ?? "PENDING") && covers(l, d)
      );
      if (mineOverlap) warnings.push(`${fmt(d)}: you already have leave on this date.`);

      available = Math.min(available, ROTA_STRENGTH - after(d, ["APPROVED"], () => true, counts));

      const awayAfter = after(d, active, () => true, counts);
      away = Math.max(away, awayAfter);
      if (awayAfter > MAX_LEAVE_PER_DUTY_DAY)
        problems.push(`${fmt(d)}: ${awayAfter} people would be away (maximum ${MAX_LEAVE_PER_DUTY_DAY}).`);

      const driversAfter = after(d, active, (l) => l.isDriver === true, isDriver && counts);
      drivers = Math.max(drivers, driversAfter);
      if (isDriver && counts && driversAfter > DRIVER_LIMIT)
        warnings.push(`${fmt(d)}: drivers would be ${driversAfter} (limit ${DRIVER_LIMIT}).`);

      vl = Math.max(vl, after(d, active, (l) => l.leaveType === "VACATION", leaveType === "VACATION"));
      ovl = Math.max(
        ovl,
        after(d, active, (l) => l.leaveType === "OVERSEAS_VACATION", leaveType === "OVERSEAS_VACATION")
      );

      for (const [code, limit] of Object.entries(APPOINTMENT_LIMITS)) {
        const n = after(d, active, (l) => l.appointment === code, appointment === code && counts);
        byAppt[code] = Math.max(byAppt[code], n);
        if (appointment === code && counts && n > limit)
          warnings.push(`${fmt(d)}: ${code} would be ${n} (limit ${limit}).`);
      }
    }

    const from = isTimeOff && startTime ? startTime : DUTY_START_TIME;
    const to = isTimeOff && endTime ? endTime : DUTY_START_TIME;
    const dutyLine =
      days.length === 0
        ? "No duty days in this range"
        : days.slice(0, 3).map((d) => `${fmt(d)} · ${from} → ${to}`).join("  |  ") +
        (days.length > 3 ? `  (+${days.length - 3} more)` : "");

    return { problems, warnings, available, away, drivers, vl, ovl, byAppt, dutyLine };
  }, [leaves, isMine, isDriver, appointment, leaveType, startDate, endDate, startTime, endTime, isTimeOff, latestTimeOffEnd]);

  // Red = over the hard limit. Amber = over the guideline. Blue outline = applies to you.
  const tile = (label: string, value: number, max?: number, opts: { hard?: boolean; mine?: boolean } = {}) => {
    const over = max !== undefined && value > max && max < ROTA_STRENGTH;
    const cls = over ? (opts.hard ? " over" : " warn") : "";
    return (
      <div className={`tile${cls}${opts.mine ? " mine" : ""}`}>
        <small>{label}</small>
        {max === undefined ? value : `${value} / ${max}`}
      </div>
    );
  };
  const blocked = check.problems.length > 0;

  async function apply(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    setError("");
    setBusy(true);


    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    const { data: newLeave, errors } = await client.models.Leave.create({
      applicantName,
      leaveType: leaveType as Leave["leaveType"],
      startDate,
      endDate,
      startTime: isTimeOff ? startTime : undefined,
      endTime: isTimeOff ? endTime : undefined,
      isDriver,
      appointment: appointment || undefined,
      reason,
    });

    if (errors || !newLeave) {
      throw new Error(errors?.[0]?.message || "Failed to create leave request.");
    }

    // 2. If an optional file was attached, upload it to S3 storage
      if (attachedFile) {
        // Build clean file extension (e.g., .jpg, .png)
        const fileExt = attachedFile.name.split(".").pop() || "jpg";
        
        // Format the date/dates part (e.g., "2026-10-06" or "2026-10-06_to_2026-10-08")
        const datePart = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
        
        // Combine into: Rank_Name_Date(s).ext (replace spaces with underscores for safety)
        const customFileName = `${applicantName}_${datePart}.${fileExt}`.replace(/\s+/g, "_");
        const filePath = `screenshots/${newLeave.id}/${customFileName}`;

        await uploadData({
          path: filePath,
          data: attachedFile,
          options: {
            bucket: "leaveWorkflowStorage",
          },
        }).result;

        // 3. Update the DynamoDB record with the S3 file path reference
        await client.models.Leave.update({
          id: newLeave.id,
          screenshotPath: filePath,
        });
      }


    setBusy(false);
    if (errors) setError(errors[0]);
    else router.push("/my-leave");
  }

  return (
    <>
      <h2>Apply for leave</h2>
      <form onSubmit={apply}>
        <label className="full">
          Name
          <input name="name" value={applicantName} readOnly />
        </label>
        <label className="full">
          Leave type
          <select
            value={leaveType}
            onChange={(e) => {
              const v = e.target.value;
              setLeaveType(v);
              // Only time off may end on an off day, and only the day after the duty date.
              if (v !== "TIME_OFF" && !isDutyDay(endDate)) setEndDate(startDate);
              if (v === "TIME_OFF" && endDate > addDays(startDate, 1)) setEndDate(startDate);
            }}
          >
            {LEAVE_TYPES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <DutyDatePicker
          label="From"
          value={startDate}
          onChange={(v) => {
            setStartDate(v);
            if (endDate < v) setEndDate(v);
            else if (isTimeOff && endDate > addDays(v, 1)) setEndDate(v);
          }}
        />
        <DutyDatePicker
          label="To"
          value={endDate}
          min={startDate}
          max={isTimeOff ? latestTimeOffEnd : undefined}
          onChange={setEndDate}
          alignRight
          anyDay={isTimeOff}
        />
        {isTimeOff && (
          <>
            <label>
              Start time
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </label>
            <label>
              End time
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </label>
          </>
        )}
        <label className="full">
          Remarks (optional)
          <textarea name="reason" rows={3} />
        </label>
        {/* Modular File Uploader Component */}
        <SingleFileUploader onFileSelect={(file) => setAttachedFile(file)} />
        <div className="full chk" aria-live="polite">
          <h3>Request check</h3>
          <small>Duty affected:</small>
          <div className="duty">{check.dutyLine}</div>
          {isTimeOff && (
            <p>
              <small>Time off is separate from manpower, so it doesn&apos;t count towards the limit of 5.</small>
            </p>
          )}
          <div className="tiles">
            {tile("Available", check.available, ROTA_STRENGTH)}
            {tile("Away (max)", check.away, MAX_LEAVE_PER_DUTY_DAY, { hard: true })}
            {tile("VL", check.vl)}
            {tile("OVL", check.ovl)}
            {tile("Drivers", check.drivers, DRIVER_LIMIT, { mine: isDriver })}
            {Object.entries(APPOINTMENT_LIMITS).map(([code, limit]) =>
              tile(code, check.byAppt[code] ?? 0, limit, { mine: appointment === code })
            )}
          </div>
          {blocked && (
            <div className="verdict no" role="alert">
              <strong>Can&apos;t submit yet</strong>
              <ul>
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {check.warnings.length > 0 && (
            <div className="verdict warn">
              <strong>Over the limit</strong>
              <div>
                {blocked
                  ? "These are guidelines only."
                  : "These are guidelines, so you can still submit. Your KAH will decide."}
              </div>
              <ul>
                {check.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {!blocked && check.warnings.length === 0 && (
            <div className="verdict ok">
              <strong>Within limits</strong>
              <div>This request can be submitted.</div>
            </div>
          )}
        </div>

        <div className="full">
          <button type="submit" disabled={busy || blocked}>
            {busy ? "Submitting…" : "Submit request"}
          </button>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
        </div>
      </form>
    </>
  );
}



export default function Page() {
  return (
    <Shell>
      <ApplyForm />
    </Shell>
  );
}

