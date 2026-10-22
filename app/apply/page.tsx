
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { uploadData } from "aws-amplify/storage";

import DutyDatePicker from "../components/Dutydatepicker";
import Shell, {
  client,
  peopleOn,
  useApp,
  type Leave,
} from "../components/Shell";

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

import {
  DEDUCTS_BALANCE,
  LEAVE_DAYS_PER_DUTY,
  afterDeduction,
  planDeduction,
  sumOf,
  type Balance,
} from "../lib/Balance";

import {
  balanceOf,
  saveBalance,
} from "../lib/Balanceactions";

import { useMyMember } from "../lib/Usemymember";
import SingleFileUploader from "../components/Fileuploader";
import { v4 as uuidv4 } from "uuid";

// Infer Member directly from the generated Amplify client.
// This avoids requiring an extra Member export in Shell.tsx.
type Member = NonNullable<
  Awaited<ReturnType<typeof client.models.Member.get>>["data"]
>;

const fmt = formatDate;


const RANK_ORDER = [
  "LTA",
  "WO2",
  "SGT2",
  "SGT1",
  "CPL",
  "LCP",
];

function sortMembersByRank(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(
      String(a.rank ?? "").trim().toUpperCase()
    );

    const rankB = RANK_ORDER.indexOf(
      String(b.rank ?? "").trim().toUpperCase()
    );

    const orderA = rankA === -1 ? 999 : rankA;
    const orderB = rankB === -1 ? 999 : rankB;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return String(a.name ?? "").localeCompare(
      String(b.name ?? ""),
      "en",
      { sensitivity: "base" }
    );
  });
}


function singaporeToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

const today = singaporeToday();

function ApplyForm() {
  const router = useRouter();

  const {
    email,
    name,
    role,
    isDriver,
    isOIC,
    isApprover,
    appointment,
    leaves,
    isMine,
  } = useApp();

  const { row: myRow } = useMyMember();

  // KAH and existing OIC group can view the rota selector.
  const canApplyForOthers = isApprover || isOIC;

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");

  useEffect(() => {
    if (!canApplyForOthers) return;

    let active = true;

    async function loadMembers() {
      setMembersLoading(true);
      setMembersError("");

      try {
        const all: Member[] = [];

        const firstPage = await client.models.Member.list({
          limit: 100,
        });

        if (firstPage.errors?.length) {
          throw new Error(firstPage.errors[0].message);
        }

        all.push(...firstPage.data);

        let token = firstPage.nextToken;

        while (token) {
          const page = await client.models.Member.list({
            limit: 100,
            nextToken: token,
          });

          if (page.errors?.length) {
            throw new Error(page.errors[0].message);
          }

          all.push(...page.data);
          token = page.nextToken;
        }

        if (!active) return;

        setMembers(sortMembersByRank(all));
      } catch (err) {
        console.error("Unable to load rota:", err);

        if (active) {
          setMembersError(
            "Could not load the rota. Please refresh the page."
          );
        }
      } finally {
        if (active) {
          setMembersLoading(false);
        }
      }
    }

    void loadMembers();

    return () => {
      active = false;
    };
  }, [canApplyForOthers]);

  const selectedMember = members.find(
    (member) => member.id === selectedMemberId
  );

  const applyingForOtherPerson =
    canApplyForOthers && selectedMemberId !== "";

  const ownApplicantName = name
    ? role === "Unassigned"
      ? name
      : `${role} ${name}`
    : email;

  const applicantName =
    applyingForOtherPerson && selectedMember
      ? `${selectedMember.rank ?? ""} ${selectedMember.name}`.trim()
      : ownApplicantName;

  const [leaveType, setLeaveType] = useState("VACATION");

  const [startDate, setStartDate] = useState(() =>
    nextDutyDay(today)
  );

  const [endDate, setEndDate] = useState(() =>
    nextDutyDay(today)
  );

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [attachedFile, setAttachedFile] =
    useState<File | null>(null);

  const isTimeOff = leaveType === "TIME_OFF";

  // Duty runs 0900 to 0900.
  const latestTimeOffEnd = addDays(startDate, 1);

  // IMPORTANT:
  // This remains the existing self-application calculation.
  // Delegated applications are blocked until the backend
  // can safely resolve the selected member's ownership,
  // balance, driver status and appointment.
  const check = useMemo(() => {
    const problems: string[] = [];
    const warnings: string[] = [];

    const rangeOk =
      !!startDate &&
      !!endDate &&
      endDate >= startDate;

    if (!rangeOk) {
      problems.push(
        "End date must be on or after the start date."
      );
    }

    if (isTimeOff) {
      if (rangeOk && endDate > latestTimeOffEnd) {
        problems.push(
          "Time off can end at most 1 day after the duty date."
        );
      }

      if (!startTime || !endTime) {
        problems.push(
          "Enter the start and end time for your time off."
        );
      } else if (
        startDate === endDate &&
        endTime <= startTime
      ) {
        problems.push(
          "End time must be after the start time."
        );
      }
    }

    const days = rangeOk
      ? dutyDaysBetween(startDate, endDate)
      : [];

    const active = ["PENDING", "APPROVED"];

    const covers = (l: Leave, d: string) =>
      l.startDate <= d && l.endDate >= d;

    // Time off is excluded from manpower counts.
    const manpower = leaves.filter(
      (l) => l.leaveType !== "TIME_OFF"
    );

    const counts = !isTimeOff;

    const after = (
      d: string,
      statuses: string[],
      pred: (l: Leave) => boolean,
      applicantMatches: boolean
    ) => {
      const inGroup = manpower.filter(pred);

      const already = inGroup.some(
        (l) =>
          isMine(l) &&
          statuses.includes(l.status ?? "PENDING") &&
          covers(l, d)
      );

      return (
        peopleOn(inGroup, d, statuses).length +
        (applicantMatches && !already ? 1 : 0)
      );
    };

    let available = ROTA_STRENGTH;
    let away = 0;
    let drivers = 0;
    let vl = 0;
    let ovl = 0;

    const byAppt: Record<string, number> =
      Object.fromEntries(
        Object.keys(APPOINTMENT_LIMITS).map(
          (key) => [key, 0]
        )
      );

    for (const d of days) {
      const mineOverlap = leaves.some(
        (l) =>
          isMine(l) &&
          active.includes(l.status ?? "PENDING") &&
          covers(l, d)
      );

      if (mineOverlap) {
        warnings.push(
          `${fmt(d)}: you already have leave on this date.`
        );
      }

      available = Math.min(
        available,
        ROTA_STRENGTH -
        after(d, ["APPROVED"], () => true, counts)
      );

      const awayAfter = after(
        d,
        active,
        () => true,
        counts
      );

      away = Math.max(away, awayAfter);

      if (awayAfter > MAX_LEAVE_PER_DUTY_DAY) {
        problems.push(
          `${fmt(d)}: ${awayAfter} people would be away (maximum ${MAX_LEAVE_PER_DUTY_DAY}).`
        );
      }

      const driversAfter = after(
        d,
        active,
        (l) => l.isDriver === true,
        isDriver && counts
      );

      drivers = Math.max(drivers, driversAfter);

      if (
        isDriver &&
        counts &&
        driversAfter > DRIVER_LIMIT
      ) {
        warnings.push(
          `${fmt(d)}: drivers would be ${driversAfter} (limit ${DRIVER_LIMIT}).`
        );
      }

      vl = Math.max(
        vl,
        after(
          d,
          active,
          (l) => l.leaveType === "VACATION",
          leaveType === "VACATION"
        )
      );

      ovl = Math.max(
        ovl,
        after(
          d,
          active,
          (l) => l.leaveType === "OVERSEAS_VACATION",
          leaveType === "OVERSEAS_VACATION"
        )
      );

      for (const [code, limit] of Object.entries(
        APPOINTMENT_LIMITS
      )) {
        const n = after(
          d,
          active,
          (l) => l.appointment === code,
          appointment === code && counts
        );

        byAppt[code] = Math.max(
          byAppt[code],
          n
        );

        if (
          appointment === code &&
          counts &&
          n > limit
        ) {
          warnings.push(
            `${fmt(d)}: ${code} would be ${n} (limit ${limit}).`
          );
        }
      }
    }

    // Existing balance calculation for the logged-in user.
    const needed = DEDUCTS_BALANCE.includes(leaveType)
      ? days.length * LEAVE_DAYS_PER_DUTY
      : 0;

    let plan: {
      take: Balance;
      shortfall: number;
    } | null = null;

    let balanceNote = "";

    if (needed > 0) {
      if (myRow === undefined) {
        problems.push(
          "Checking your leave balance…"
        );
      } else if (myRow === null) {
        warnings.push(
          "No leave balance was found for your account, so nothing will be deducted. Please ask your KAH."
        );
      } else {
        const bal = balanceOf(myRow);
        const p = planDeduction(bal, needed);

        plan = p;

        if (p.shortfall > 0) {
          problems.push(
            `Not enough leave balance: this needs ${needed} days (${days.length} duty × ${LEAVE_DAYS_PER_DUTY}) but you only have ${sumOf(bal)}.`
          );
        } else {
          const used = (
            ["oil", "al", "phol"] as const
          )
            .filter((key) => p.take[key] > 0)
            .map(
              (key) =>
                `${key.toUpperCase()} ${p.take[key]}`
            )
            .join(", ");

          const left = afterDeduction(
            bal,
            p.take
          );

          balanceNote =
            `This uses ${needed} days (${days.length} duty × ${LEAVE_DAYS_PER_DUTY}): ${used}. ` +
            `After: OIL ${left.oil} · AL ${left.al} · PHOL ${left.phol}.`;
        }
      }
    }

    const from =
      isTimeOff && startTime
        ? startTime
        : DUTY_START_TIME;

    const to =
      isTimeOff && endTime
        ? endTime
        : DUTY_START_TIME;

    const dutyLine =
      days.length === 0
        ? "No duty days in this range"
        : days
          .slice(0, 3)
          .map(
            (d) =>
              `${fmt(d)} · ${from} → ${to}`
          )
          .join("  |  ") +
        (days.length > 3
          ? `  (+${days.length - 3} more)`
          : "");

    return {
      problems,
      warnings,
      available,
      away,
      drivers,
      vl,
      ovl,
      byAppt,
      dutyLine,
      plan,
      balanceNote,
    };
  }, [
    leaves,
    isMine,
    isDriver,
    appointment,
    myRow,
    leaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    isTimeOff,
    latestTimeOffEnd,
  ]);

  const tile = (
    label: string,
    value: number,
    max?: number,
    opts: {
      hard?: boolean;
      mine?: boolean;
    } = {}
  ) => {
    const over =
      max !== undefined &&
      value > max &&
      max < ROTA_STRENGTH;

    const cls = over
      ? opts.hard
        ? " over"
        : " warn"
      : "";

    return (
      <div
        className={`tile${cls}${opts.mine ? " mine" : ""}`}
      >
        <small>{label}</small>
        {max === undefined
          ? value
          : `${value} / ${max}`}
      </div>
    );
  };

  // Until the delegated backend is ready, don't allow
  // another member's leave to be created by the OIC.
  const blocked = applyingForOtherPerson
    ? !selectedMember || !startDate || !endDate
    : check.problems.length > 0;

  async function applyForSelectedMember(
    reason: string
  ) {
    if (
      !canApplyForOthers ||
      !selectedMember ||
      !applyingForOtherPerson
    ) {
      throw new Error("No member selected.");
    }

    if (attachedFile) {
      throw new Error(
        "Attachments for delegated applications are not enabled yet."
      );
    }

    const { data, errors } =
      await client.mutations.submitLeaveForMember({
        memberId: selectedMember.id,
        leaveType,
        startDate,
        endDate,
        startTime: isTimeOff ? startTime : undefined,
        endTime: isTimeOff ? endTime : undefined,
        reason,
        requestId: crypto.randomUUID(),
      });

    if (errors?.length) {
      throw new Error(errors[0].message);
    }

    if (!data?.leaveId) {
      throw new Error("The backend did not return a leave ID.");
    }

    return data.leaveId;
  }

  async function apply(
    e: React.SyntheticEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (blocked || busy || done) {
      return;
    }

    setError("");
    setBusy(true);

    const reason = String(
      new FormData(e.currentTarget).get("reason") ?? ""
    );

    if (applyingForOtherPerson) {
      try {
        await applyForSelectedMember(reason);

        router.push("/");
      } catch (err) {
        console.error("Delegated submission failed:", err);

        setError(
          err instanceof Error
            ? err.message
            : "Could not submit the application."
        );
      } finally {
        setBusy(false);
      }

      return;
    }

    let before: Balance | null = null;
    let leaveSaved = false;

    try {
      // 1. Deduct the logged-in user's balance.
      if (check.plan && myRow) {
        before = balanceOf(myRow);

        const { errors: balanceErrors } =
          await saveBalance(
            myRow.id,
            afterDeduction(
              before,
              check.plan.take
            )
          );

        if (balanceErrors?.length) {
          before = null;

          setError(
            `Could not update your leave balance: ${balanceErrors[0].message}`
          );

          return;
        }
      }

      // 2. Create the existing self-owned leave request.
      const { data: newLeave, errors } =
        await client.models.Leave.create({
          applicantName,
          leaveType:
            leaveType as Leave["leaveType"],
          startDate,
          endDate,
          startTime: isTimeOff
            ? startTime
            : undefined,
          endTime: isTimeOff
            ? endTime
            : undefined,
          isDriver,
          appointment:
            appointment || undefined,
          reason,
          deductedOil:
            check.plan?.take.oil,
          deductedAl:
            check.plan?.take.al,
          deductedPhol:
            check.plan?.take.phol,
        });

      if (errors?.length || !newLeave) {
        if (before && myRow) {
          await saveBalance(
            myRow.id,
            before
          );
        }

        setError(
          errors?.[0]?.message ||
          "Could not submit your request. Please try again."
        );

        return;
      }

      leaveSaved = true;

      // 3. Upload the optional screenshot.
      if (attachedFile) {
        try {
          const fileExt =
            attachedFile.name
              .split(".")
              .pop() || "jpg";

          const datePart =
            startDate === endDate
              ? startDate
              : `${startDate}_to_${endDate}`;

          const customFileName =
            `${applicantName}_${datePart}.${fileExt}`
              .replace(/\s+/g, "_");

          const filePath =
            `screenshots/${newLeave.id}/${customFileName}`;

          await uploadData({
            path: filePath,
            data: attachedFile,
            options: {
              bucket:
                "leaveWorkflowStorage",
            },
          }).result;

          // 4. Associate the uploaded screenshot.
          const updateResult =
            await client.models.Leave.update({
              id: newLeave.id,
              screenshotPath: filePath,
            });

          if (updateResult.errors?.length) {
            throw new Error(
              updateResult.errors[0].message
            );
          }
        } catch (err) {
          console.error(
            "Attachment upload failed:",
            err
          );

          setDone(true);
          setError(
            "Your request was submitted, but the attachment could not be uploaded."
          );

          return;
        }
      }

      router.push("/my-leave");
    } catch (err) {
      console.error(
        "Submit failed:",
        err
      );

      if (
        before &&
        myRow &&
        !leaveSaved
      ) {
        try {
          await saveBalance(
            myRow.id,
            before
          );
        } catch (undoErr) {
          console.error(
            "Could not put the leave balance back:",
            undoErr
          );
        }
      }

      setError(
        "Something went wrong while submitting. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Apply for leave</h2>

      <form
        className="apply-form"
        onSubmit={apply}
        autoComplete="off"
      >
        <label className="full">
          Name

          {canApplyForOthers ? (
            <select
              value={selectedMemberId}
              onChange={(e) =>
                setSelectedMemberId(
                  e.target.value
                )
              }
              disabled={membersLoading}
            >
              <option value="">
                Myself
              </option>

              {members.map((member) => (
                <option
                  key={member.id}
                  value={member.id}
                >
                  {member.rank
                    ? `${member.rank} `
                    : ""}
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="name"
              value={ownApplicantName}
              readOnly
            />
          )}
        </label>

        {membersLoading && (
          <p className="full">
            <small>
              Loading rota members…
            </small>
          </p>
        )}

        {membersError && (
          <p
            className="full alert"
            role="alert"
          >
            {membersError}
          </p>
        )}

        <label className="full">
          Leave type

          <select
            value={leaveType}
            onChange={(e) => {
              const v = e.target.value;

              setLeaveType(v);

              if (
                v !== "TIME_OFF" &&
                !isDutyDay(endDate)
              ) {
                setEndDate(startDate);
              }

              if (
                v === "TIME_OFF" &&
                endDate >
                addDays(startDate, 1)
              ) {
                setEndDate(startDate);
              }
            }}
          >
            {LEAVE_TYPES.map(
              ([value, title]) => (
                <option
                  key={value}
                  value={value}
                >
                  {title}
                </option>
              )
            )}
          </select>
        </label>

        <DutyDatePicker
          label="From"
          value={startDate}
          onChange={(value) => {
            setStartDate(value);

            if (endDate < value) {
              setEndDate(value);
            } else if (
              isTimeOff &&
              endDate >
              addDays(value, 1)
            ) {
              setEndDate(value);
            }
          }}
        />

        <DutyDatePicker
          label="To"
          value={endDate}
          min={startDate}
          max={
            isTimeOff
              ? latestTimeOffEnd
              : undefined
          }
          onChange={setEndDate}
          alignRight
          anyDay={isTimeOff}
        />

        {isTimeOff && (
          <>
            <label>
              Start time
              <input
                type="time"
                value={startTime}
                onChange={(e) =>
                  setStartTime(
                    e.target.value
                  )
                }
                required
              />
            </label>

            <label>
              End time
              <input
                type="time"
                value={endTime}
                onChange={(e) =>
                  setEndTime(
                    e.target.value
                  )
                }
                required
              />
            </label>
          </>
        )}

        <label className="full">
          Remarks (optional)
          <textarea
            name="reason"
            rows={3}
          />
        </label>

        {!applyingForOtherPerson && (
          <div className="full">
            <SingleFileUploader
              onFileSelect={(file) => setAttachedFile(file)}
            />
          </div>
        )}

        <div
          className="full chk"
          aria-live="polite"
        >
          <h3>Request check</h3>

          <small>Duty affected:</small>

          <div className="duty">
            {check.dutyLine}
          </div>

          {isTimeOff && (
            <p>
              <small>
                Time off is separate from
                manpower, so it doesn't
                count towards the limit
                of 5.
              </small>
            </p>
          )}

          <div className="tiles">
            {tile(
              "Available",
              check.available,
              ROTA_STRENGTH
            )}

            {tile(
              "Away (max)",
              check.away,
              MAX_LEAVE_PER_DUTY_DAY,
              { hard: true }
            )}

            {tile("VL", check.vl)}

            {tile("OVL", check.ovl)}

            {tile(
              "Drivers",
              check.drivers,
              DRIVER_LIMIT,
              { mine: isDriver }
            )}

            {Object.entries(
              APPOINTMENT_LIMITS
            ).map(([code, limit]) =>
              tile(
                code,
                check.byAppt[code] ?? 0,
                limit,
                {
                  mine:
                    appointment === code,
                }
              )
            )}
          </div>

          {check.balanceNote && (
            <p>
              <small>
                {check.balanceNote}
              </small>
            </p>
          )}

          {blocked && (
            <div
              className="verdict no"
              role="alert"
            >
              <strong>
                Can't submit yet
              </strong>

              {check.problems.length >
                0 && (
                  <ul>
                    {check.problems.map(
                      (problem) => (
                        <li key={problem}>
                          {problem}
                        </li>
                      )
                    )}
                  </ul>
                )}

            </div>
          )}

          {check.warnings.length >
            0 && (
              <div className="verdict warn">
                <strong>
                  Over the limit
                </strong>

                <div>
                  {blocked
                    ? "These are guidelines only."
                    : "These are guidelines, so you can still submit. Your KAH will decide."}
                </div>

                <ul>
                  {check.warnings.map(
                    (warning) => (
                      <li key={warning}>
                        {warning}
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

          {!blocked &&
            check.warnings.length ===
            0 && (
              <div className="verdict ok">
                <strong>
                  Within limits
                </strong>
                <div>
                  This request can be
                  submitted.
                </div>
              </div>
            )}
        </div>

        <div className="full actions">
          {error && (
            <p
              role="alert"
              className="alert"
            >
              {error}
            </p>
          )}

          {done && (
            <p>
              <Link href="/my-leave">
                Go to My leave
              </Link>
            </p>
          )}

          {blocked && (
            <p>
              <small>
                Can't submit yet. See
                the Request check above.
              </small>
            </p>
          )}

          <button
            type="submit"
            disabled={
              busy ||
              blocked ||
              done
            }
          >
            {busy
              ? "Submitting…"
              : "Submit request"}
          </button>
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
