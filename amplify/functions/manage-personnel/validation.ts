// Shared validation for KAH-managed personnel registration.
// This module has no AWS side effects and is safe to unit test.
export const PERSONNEL_COLUMNS = [
  "rank", "name", "email", "phone", "driver", "appointment",
  "al", "oil", "phol", "total_leave_balance", "total_duties", "mc_count",
] as const;

export type PersonnelColumn = (typeof PERSONNEL_COLUMNS)[number];
export type PersonnelInput = Record<PersonnelColumn, string>;

const RANKS = new Set(["LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP"]);
const APPOINTMENTS = new Set(["", "FF", "SC", "RC", "DRC"]);

export function validatePersonnel(input: PersonnelInput) {
  const errors: string[] = [];
  const rank = input.rank.trim().toUpperCase();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const appointment = input.appointment.trim().toUpperCase();
  const driverValue = input.driver.trim().toLowerCase();

  if (!RANKS.has(rank)) errors.push("Invalid rank.");
  if (!name) errors.push("Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email.");
  if (!phone || !/^\+?[0-9 ()-]{7,20}$/.test(phone)) errors.push("Invalid phone.");
  if (!APPOINTMENTS.has(appointment)) errors.push("Invalid appointment.");
  if (!["true", "false", "yes", "no", "1", "0"].includes(driverValue)) {
    errors.push("Driver must be yes/no or true/false.");
  }

  const readNumber = (field: PersonnelColumn) => {
    const raw = input[field].trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) {
      errors.push(`Invalid nonnegative number: ${field}.`);
    }
    return value;
  };
  const al = readNumber("al");
  const oil = readNumber("oil");
  const phol = readNumber("phol");
  const totalLeaveBalance = readNumber("total_leave_balance");
  const totalDuties = readNumber("total_duties");
  const mcCount = readNumber("mc_count");
  if (!Number.isInteger(mcCount)) errors.push("MC count must be an integer.");

  const expectedBalance = Math.round((al + oil + phol) * 100) / 100;
  const expectedDuties = Math.round((expectedBalance / 2) * 100) / 100;
  if (Number.isFinite(expectedBalance) && Math.abs(totalLeaveBalance - expectedBalance) > 0.001) {
    errors.push("Total leave balance must equal AL + OIL + PHOL.");
  }
  if (Number.isFinite(expectedDuties) && Math.abs(totalDuties - expectedDuties) > 0.001) {
    errors.push("Total duties must equal total leave balance / 2.");
  }

  return {
    errors,
    value: {
      rank, name, email, phone, appointment,
      driver: ["true", "yes", "1"].includes(driverValue),
      al, oil, phol, totalLeaveBalance, totalDuties, mcCount,
    },
  };
}

export function assertKahGroups(groups: readonly string[]) {
  if (!groups.some(group => group === "LTA" || group === "WO2")) {
    throw new Error("Only KAH (LTA or WO2) can manage personnel.");
  }
}
