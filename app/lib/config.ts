// Tunable numbers and lists for the whole app. Change these here, not in components.

// Total strength of your rota. Change this number if it changes.
export const ROTA_STRENGTH = 33;

// Duty pattern: 1 day on, 2 days off (3-day cycle).
// DUTY_ANCHOR is any date your rota is on duty; all other duty dates follow from it.
export const DUTY_ANCHOR = "2026-10-04";
export const DUTY_CYCLE = 3;

// Most different people allowed on leave (pending or approved) on one duty day.
export const MAX_LEAVE_PER_DUTY_DAY = 5;

// Duty runs from this time to the same time the next day.
export const DUTY_START_TIME = "09:00";

// Guidelines only (they never block an application): most people who should be on leave
// (pending or approved) on one duty day, by driver flag and appointment.
export const DRIVER_LIMIT = 2;
export const APPOINTMENT_LIMITS: Record<string, number> = { RC: 1, DRC: 1, SC: 2, FF: 3 };

// Lists show this many requests per page.
export const PAGE_SIZE = 7;

// Ranks, highest to lowest. Each is a Cognito group. LTA and WO2 are KAH and can approve leave.
export const RANKS = ["LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP"];
export const KAH_RANKS = ["LTA", "WO2"];

// Appointments. Each is a Cognito group named APPT_<code>. They are shown on screen only.
export const APPOINTMENTS = ["FF", "SC", "RC", "DRC"];

export const LEAVE_TYPES = [
  ["VACATION", "Vacation leave"],
  ["OVERSEAS_VACATION", "Overseas vacation leave"],
  ["SICK", "Sick leave"],
  ["HOSPITALISATION", "Hospitalisation leave"],
  ["ON_COURSE", "On course"],
  ["MARCHING", "Marching"],
  ["CHILDCARE", "Childcare leave"],
  ["EMERGENCY", "Emergency leave"],
  ["TIME_OFF", "Time off"],
  ["OTHERS", "Others"],
] as const;
