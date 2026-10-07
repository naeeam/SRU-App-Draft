// Saving leave balances. Uses the signed-in person's access, so see the Member rules in the schema.
import { client, type Leave, type Member } from "../components/Shell";
import { afterDeduction, afterRefund, planDeduction, sumOf, totalsOf, type Balance } from "./Balance.ts";

export type Result = { ok: boolean; message: string };
const OK: Result = { ok: true, message: "" };

export const balanceOf = (m: Member): Balance => ({
  oil: m.oil ?? 0,
  al: m.al ?? 0,
  phol: m.phol ?? 0,
});

// Writes AL, OIL and PHOL together with the two totals, so they never disagree.
export function saveBalance(memberId: string, b: Balance) {
  return client.models.Member.update({
    id: memberId,
    al: b.al,
    oil: b.oil,
    phol: b.phol,
    ...totalsOf(b),
  });
}

// What was taken from each balance when this leave was applied for.
const takenOf = (l: Leave): Balance => ({
  oil: l.deductedOil ?? 0,
  al: l.deductedAl ?? 0,
  phol: l.deductedPhol ?? 0,
});

// A leave's owner looks like "sub::username". The sub matches Member.userId.
async function memberOf(leave: Leave): Promise<Member | null> {
  const sub = (leave.owner ?? "").split("::")[0];
  if (!sub) return null;
  const { data } = await client.models.Member.list({ filter: { userId: { eq: sub } } });
  return data[0] ?? null;
}

// Gives back what a leave took. Use when it is cancelled (markLeave: false, the request is deleted)
// or rejected (the default, so it is only ever refunded once).
export async function refundLeave(leave: Leave, opts: { markLeave?: boolean } = {}): Promise<Result> {
  const taken = takenOf(leave);
  if (sumOf(taken) === 0 || leave.balanceRefunded) return OK;
  const member = await memberOf(leave);
  if (!member) return { ok: false, message: "Could not find that person's leave balance to refund." };
  const { errors } = await saveBalance(member.id, afterRefund(balanceOf(member), taken));
  if (errors) return { ok: false, message: `Could not refund the leave balance: ${errors[0].message}` };
  if (opts.markLeave !== false) await client.models.Leave.update({ id: leave.id, balanceRefunded: true });
  return OK;
}

// Takes the balance again when a rejected leave is brought back (approved or pending).
export async function redeductLeave(leave: Leave): Promise<Result> {
  const taken = takenOf(leave);
  if (sumOf(taken) === 0 || !leave.balanceRefunded) return OK;
  const member = await memberOf(leave);
  if (!member) return { ok: false, message: "Could not find that person's leave balance to deduct." };
  const bal = balanceOf(member);
  const plan = planDeduction(bal, sumOf(taken));
  const { errors } = await saveBalance(member.id, afterDeduction(bal, plan.take));
  if (errors) return { ok: false, message: `Could not deduct the leave balance: ${errors[0].message}` };
  await client.models.Leave.update({
    id: leave.id,
    deductedOil: plan.take.oil,
    deductedAl: plan.take.al,
    deductedPhol: plan.take.phol,
    balanceRefunded: false,
  });
  return plan.shortfall > 0
    ? { ok: true, message: `That person's balance was short by ${plan.shortfall} days, so only part was deducted.` }
    : OK;
}