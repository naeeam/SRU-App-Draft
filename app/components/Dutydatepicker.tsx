"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate, isDutyDay } from "../lib/dates";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (n: number) => String(n).padStart(2, "0");

// A calendar where only duty days can be picked. Off days are greyed out.
// With anyDay, every date can be picked, and duty days are still shown in bold.
// min and max grey out dates before and after them.
export default function DutyDatePicker({
  label,
  value,
  onChange,
  min,
  max,
  alignRight,
  anyDay,
}: {
  label: string;
  value: string; // yyyy-mm-dd
  onChange: (v: string) => void;
  min?: string; // earlier days are greyed out too
  max?: string; // later days are greyed out too
  alignRight?: boolean; // open the calendar towards the left (for pickers at the right edge)
  anyDay?: boolean; // allow any date, not just duty days
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({
    y: Number(value.slice(0, 4)),
    m: Number(value.slice(5, 7)) - 1,
  }));
  const box = useRef<HTMLDivElement>(null);
  const today = new Date().toLocaleDateString("en-CA");

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function toggle() {
    if (!open) setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 });
    setOpen(!open);
  }
  function shift(by: number) {
    const d = new Date(Date.UTC(view.y, view.m + by, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }

  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();

  return (
    <div className="dp" ref={box}>
      <span id={`dp-${label}`}>{label}</span>
      <button
        type="button"
        className="dp-btn"
        aria-labelledby={`dp-${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{formatDate(value)}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={`dp-pop${alignRight ? " right" : ""}`} role="dialog" aria-label={`Choose ${label} date`}>
          <div className="dp-head">
            <button type="button" className="ghost" onClick={() => shift(-1)} aria-label="Previous month">
              ‹
            </button>
            <span aria-live="polite">
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" className="ghost" onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="dp-grid">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <i key={`b${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const iso = `${view.y}-${pad(view.m + 1)}-${pad(i + 1)}`;
              const duty = isDutyDay(iso);
              const selectable = (anyDay || duty) && (!min || iso >= min) && (!max || iso <= max);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!selectable}
                  style={anyDay && !duty ? { fontWeight: 400 } : undefined}
                  className={`${iso === value ? "sel" : ""} ${iso === today ? "today" : ""}`}
                  aria-pressed={iso === value}
                  aria-label={`${formatDate(iso)}${duty ? ", duty day" : ", not a duty day"}`}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <small>
            {anyDay && max
              ? "Can end on the duty date or the day after. Bold dates are duty days."
              : anyDay
              ? "Any date can be picked. Bold dates are duty days."
              : "Only your duty days can be picked."}
          </small>
        </div>
      )}
    </div>
  );
}