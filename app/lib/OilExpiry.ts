/**
 * OIL expiry rules. Dates are calendar days in Asia/Singapore.
 * An award is usable through 23:59:59 on its expiry date.
 * Once deducted on a valid application date, the reserved OIL stays valid
 * for that application even if its leave date is later.
 */
export type OilCredit = {
  id: string;
  amount: number;
  remaining: number;
  expiryDate: string;
};

export type OilAllocation = { creditId: string; amount: number; expiryDate: string };

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function singaporeDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function availableOil(credits: OilCredit[], applicationDate: string): number {
  if (!isValidDate(applicationDate)) throw new Error("Invalid application date.");
  return round(credits.reduce((sum, credit) =>
    sum + (credit.expiryDate >= applicationDate ? Math.max(0, credit.remaining) : 0), 0));
}

/** Earliest-expiring valid credit is spent first; never use an expired credit. */
export function allocateOil(
  credits: OilCredit[], amount: number, applicationDate: string,
): { allocations: OilAllocation[]; shortfall: number } {
  if (!Number.isFinite(amount) || amount < 0 || !isValidDate(applicationDate)) {
    throw new Error("Invalid OIL allocation request.");
  }
  let remaining = round(amount);
  const allocations: OilAllocation[] = [];
  for (const credit of [...credits].sort((a, b) =>
    a.expiryDate.localeCompare(b.expiryDate) || a.id.localeCompare(b.id))) {
    if (credit.expiryDate < applicationDate || credit.remaining <= 0) continue;
    if (!Number.isFinite(credit.remaining) || credit.remaining < 0) {
      throw new Error("Invalid OIL credit balance.");
    }
    const used = round(Math.min(remaining, credit.remaining));
    if (used > 0) {
      allocations.push({ creditId: credit.id, amount: used, expiryDate: credit.expiryDate });
      remaining = round(remaining - used);
    }
    if (remaining === 0) break;
  }
  return { allocations, shortfall: remaining };
}

/** Cancelled/rejected leave cannot revive a credit after its original expiry. */
export function refundableOil(
  allocations: OilAllocation[], refundDate: string,
): OilAllocation[] {
  if (!isValidDate(refundDate)) throw new Error("Invalid refund date.");
  return allocations.filter(a => a.expiryDate >= refundDate);
}
