"use client";

import { useState } from "react";
import Link from "next/link";
import DutyDatePicker from "./components/Dutydatepicker";
import Shell, { peopleOn, useApp } from "./components/Shell";
import {
  DUTY_CYCLE,
  LEAVE_TYPES,
  MAX_LEAVE_PER_DUTY_DAY,
  ROTA_STRENGTH,
} from "./lib/config";
import { addDays, formatDate, formatDateTime, nextDutyDay } from "./lib/dates";

function Dashboard() {
  const { isApprover, leaves } = useApp();
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = useState(() => nextDutyDay(today));

  // Time off is separate from manpower: it never reduces strength
  // and never uses up one of the leave slots.
  const manpower = leaves.filter((l) => l.leaveType !== "TIME_OFF");
  const timeOffOn = (d: string) =>
    leaves.filter(
      (l) => l.leaveType === "TIME_OFF" && l.status === "APPROVED" && l.startDate <= d && l.endDate >= d
    );

  const away = peopleOn(manpower, date, ["APPROVED"]);
  const timeOff = timeOffOn(date);
  const available = ROTA_STRENGTH - away.length;
  const pending = leaves.filter((l) => l.status === "PENDING").length;
  const next7 = Array.from({ length: 7 }, (_, i) => addDays(date, i * DUTY_CYCLE));

  return (
    <>
      <h2>Rota strength</h2>
      <div className="dp-slot">
        <DutyDatePicker label="Date" value={date} onChange={setDate} />
      </div>

      <div className="stats">
        <div className="stat"><b>{ROTA_STRENGTH}</b>Total</div>
        <div className="stat ok"><b>{available}</b>Available</div>
        <div className="stat no"><b>{away.length}</b>Unavailable</div>
        <div className="stat info"><b>{timeOff.length}</b>Time off</div>
      </div>
      <small className="footnote">Time off is separate from rota strength and never reduces it.</small>

      {isApprover && pending > 0 && (
        <p className="notice">
          {pending} leave request{pending > 1 ? "s" : ""} waiting. <Link href="/approvals">Go to approvals</Link>
        </p>
      )}

      <h2>Unavailable on {formatDate(date)}</h2>
      {away.length === 0 ? (
        <p className="empty">Everyone is available.</p>
      ) : (
        <ul>
          {away.map((l) => (
            <li key={l.id} className="accent">
              <div>
                <strong>{l.applicantName}</strong>
                {isApprover && (
                  <small> · {LEAVE_TYPES.find(([v]) => v === l.leaveType)?.[1]}</small>
                )}
              </div>
              <small>Back after {formatDate(l.endDate)}</small>
            </li>
          ))}
        </ul>
      )}

      <h2 className="info">Time off on {formatDate(date)}</h2>
      {timeOff.length === 0 ? (
        <p className="empty">No one has time off.</p>
      ) : (
        <ul>
          {timeOff.map((l) => (
            <li key={l.id} className="info">
              <div>
                <strong>{l.applicantName}</strong>
              </div>
              <small>
                {formatDateTime(l.startDate, l.startTime)} to {formatDateTime(l.endDate, l.endTime)}
              </small>
            </li>
          ))}
        </ul>
      )}

      <h2>Next 7 duty days</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Next 7 duty days">
        <table>
          <caption className="sr-only">
            Available, unavailable and time off for the next 7 duty days
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Available</th>
              <th scope="col">Unavailable</th>
              <th scope="col" className="info-text">Time off</th>
              <th scope="col">Leave slots left</th>
              <th scope="col"><span className="sr-only">Strength</span></th>
            </tr>
          </thead>
          <tbody>
            {next7.map((d) => {
              const n = peopleOn(manpower, d, ["APPROVED"]).length;
              const taken = peopleOn(manpower, d, ["PENDING", "APPROVED"]).length;
              return (
                <tr key={d}>
                  <td>{formatDate(d)}</td>
                  <td>{ROTA_STRENGTH - n}</td>
                  <td>{n}</td>
                  <td className="info-text">{timeOffOn(d).length}</td>
                  <td>{Math.max(0, MAX_LEAVE_PER_DUTY_DAY - taken)} of {MAX_LEAVE_PER_DUTY_DAY}</td>
                  <td className="col-bar">
                    <div className="bar"><i style={{ width: `${((ROTA_STRENGTH - n) / ROTA_STRENGTH) * 100}%` }} /></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <Dashboard />
    </Shell>
  );
}