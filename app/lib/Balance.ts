// Leave balance rules. Pure functions only, so they are easy to test and change.

// Leave types that use up AL, OIL or PHOL. Everything else (sick, time off, on course...) does not.
export const DEDUCTS_BALANCE = ["VACATION", "OVERSEAS_VACATION"];

// One duty off is worth this many days of leave.
export const LEAVE_DAYS_PER_DUTY = 2;

export type Balance = { oil: number; al: number; phol: number };

// The order balances are used up in: OIL first, then AL, and PHOL last.
export const DEDUCTION_ORDER: (keyof Balance)[] = ["oil", "al", "phol"];

const r2 = (n: number) => Math.round(n * 100) / 100;

export const sumOf = (b: Balance) => r2(b.oil + b.al + b.phol);

// Total Leave Balance = AL + OIL + PHOL, Total Duties = Total Leave Balance / 2
export const totalsOf = (b: Balance) => ({
  totalLeaveBalance: sumOf(b),
  totalDuties: r2(sumOf(b) / 2),
});

// How much to take from each balance to cover `days` days of leave.
// shortfall is whatever could not be covered (0 means there was enough).
export function planDeduction(bal: Balance, days: number) {
  let need = r2(days);
  const take: Balance = { oil: 0, al: 0, phol: 0 };
  for (const k of DEDUCTION_ORDER) {
    const t = Math.min(need, Math.max(0, bal[k]));
    take[k] = r2(t);
    need = r2(need - t);
  }
  return { take, shortfall: need };
}

export const afterDeduction = (bal: Balance, take: Balance): Balance => ({
  oil: r2(bal.oil - take.oil),
  al: r2(bal.al - take.al),
  phol: r2(bal.phol - take.phol),
});

export const afterRefund = (bal: Balance, take: Balance): Balance => ({
  oil: r2(bal.oil + take.oil),
  al: r2(bal.al + take.al),
  phol: r2(bal.phol + take.phol),
});