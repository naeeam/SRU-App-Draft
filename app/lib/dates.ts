import { DUTY_ANCHOR, DUTY_CYCLE } from "./config";

// One date format for the whole app: dd/mm/yyyy, with 24-hour time (HH:MM) where there is one.
// Dates are stored as yyyy-mm-dd; only use these two functions to show them.
export const formatDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
export const formatDateTime = (d: string, t?: string | null) =>
  t ? `${formatDate(d)} ${t}` : formatDate(d);

export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Days since the anchor duty day, modulo the cycle. 0 means on duty.
export const dutyOffset = (d: string) => {
  const diff = Math.round(
    (Date.parse(d + "T00:00:00Z") - Date.parse(DUTY_ANCHOR + "T00:00:00Z")) / 864e5
  );
  return ((diff % DUTY_CYCLE) + DUTY_CYCLE) % DUTY_CYCLE;
};
export const isDutyDay = (d: string) => dutyOffset(d) === 0;
export const nextDutyDay = (d: string) => {
  const o = dutyOffset(d);
  return o === 0 ? d : addDays(d, DUTY_CYCLE - o);
};

export const dutyDaysBetween = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++)
    if (isDutyDay(d)) out.push(d);
  return out;
};
