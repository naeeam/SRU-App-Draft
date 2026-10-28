import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;
const OIL_CREDIT_TABLE = process.env.OIL_CREDIT_TABLE_NAME!;
const OIL_ALLOCATION_TABLE = process.env.OIL_ALLOCATION_TABLE_NAME!;
const LEAVE_TABLE = process.env.LEAVE_TABLE_NAME!;

function singaporeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
async function scanAll(tableName: string, filter?: string, values?: Record<string, unknown>) {
  const items: Record<string, any>[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const response = await db.send(new ScanCommand({
      TableName: tableName, ...(filter ? { FilterExpression: filter } : {}),
      ...(values ? { ExpressionAttributeValues: values } : {}),
      ConsistentRead: true, ExclusiveStartKey: cursor,
    }));
    items.push(...(response.Items ?? []));
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return items;
}

export const handler: Schema["manageOilCredits"]["functionHandler"] = async event => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Sign in required.");
  const claims = event.identity.claims;
  const raw = claims["cognito:groups"];
  const groups = Array.isArray(raw) ? raw.map(String) :
    typeof raw === "string" ? raw.split(",").map(v => v.trim()) : [];
  if (!groups.some(group => group === "LTA" || group === "WO2")) throw new Error("KAH only.");

  const action = String(event.arguments.action ?? "");
  const ids = [...new Set((event.arguments.creditIds ?? []).map(String).filter(Boolean))];
  const newExpiry = String(event.arguments.expiryDate ?? "");
  if (!["CHANGE_EXPIRY", "VOID"].includes(action)) throw new Error("Invalid OIL management action.");
  if (!ids.length || ids.length > 40) throw new Error("Select between 1 and 40 OIL awards per operation.");
  if (action === "CHANGE_EXPIRY" && (!validDate(newExpiry) || newExpiry < singaporeDate())) {
    throw new Error("New expiry date must be today or a future date in Singapore.");
  }

  const nowDate = singaporeDate();
  const credits = await Promise.all(ids.map(async id => {
    const response = await db.send(new GetCommand({
      TableName: OIL_CREDIT_TABLE, Key: { id }, ConsistentRead: true,
    }));
    if (!response.Item) throw new Error("An award no longer exists. Refresh the list and try again.");
    return response.Item;
  }));
  for (const credit of credits) {
    if (credit.voidedAt) throw new Error("Voided awards cannot be edited.");
    if (String(credit.expiryDate ?? "") < nowDate || Number(credit.remaining ?? 0) <= 0) {
      throw new Error("Only unexpired awards with a remaining balance can be managed.");
    }
    if (!credit.memberId || !Number.isFinite(Number(credit.amount)) ||
        !Number.isFinite(Number(credit.remaining)) || Number(credit.remaining) < 0) {
      throw new Error("An award has invalid ledger data.");
    }
  }

  if (action === "CHANGE_EXPIRY") {
    const tx = credits.map(credit => ({
      Update: {
        TableName: OIL_CREDIT_TABLE, Key: { id: credit.id },
        UpdateExpression: "SET expiryDate = :newExpiry, updatedAt = :now",
        ConditionExpression: "expiryDate = :oldExpiry AND remaining = :remaining AND attribute_not_exists(voidedAt)",
        ExpressionAttributeValues: {
          ":newExpiry": newExpiry, ":now": new Date().toISOString(),
          ":oldExpiry": credit.expiryDate, ":remaining": credit.remaining,
        },
      },
    }));
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
    return { message: `Expiry date updated for ${credits.length} OIL award(s).` };
  }

  // The current legacy leave flow does not write OilAllocation rows yet. To avoid
  // removing OIL that may already have been spent, only void awards where we can
  // prove no OIL-deducting leave was submitted after the award was issued.
  const allocations = await scanAll(OIL_ALLOCATION_TABLE);
  const leaves = await scanAll(LEAVE_TABLE);
  const allCredits = await scanAll(OIL_CREDIT_TABLE);
  const memberCache = new Map<string, Record<string, any>>();
  for (const credit of credits) {
    if (allocations.some(allocation => allocation.creditId === credit.id && Number(allocation.amount ?? 0) > 0)) {
      throw new Error("At least one selected award has recorded allocations. It cannot be voided by this operation.");
    }
    const member = memberCache.get(String(credit.memberId)) ?? (await db.send(new GetCommand({
      TableName: MEMBER_TABLE, Key: { id: credit.memberId }, ConsistentRead: true,
    }))).Item;
    if (!member) throw new Error("An award's personnel record no longer exists.");
    memberCache.set(String(credit.memberId), member);
    const ledgerRemaining = allCredits
      .filter(row => String(row.memberId) === String(credit.memberId) && !row.voidedAt)
      .reduce((sum, row) => sum + Number(row.remaining ?? 0), 0);
    if (Number(member.oil ?? 0) + 0.000001 < ledgerRemaining) {
      throw new Error(`Cannot safely void OIL for ${member.name ?? member.id}: the recorded award ledger exceeds the current OIL balance. Reconcile the ledger first.`);
    }
    if (Math.abs(Number(credit.remaining) - Number(credit.amount)) > 0.000001) {
      throw new Error(`Cannot safely void award ${credit.id}: its remaining amount differs from the original amount.`);
    }
    const identityParts = [String(member.userId ?? ""), String(member.id ?? "")].filter(Boolean);
    const usageAfterAward = leaves.some(leave => {
      const owner = String(leave.owner ?? "");
      const ownerMatches = identityParts.some(part => owner.split("::").includes(part));
      return ownerMatches && String(leave.createdAt ?? "") >= String(credit.awardedAt ?? "") &&
        Number(leave.deductedOil ?? 0) > 0;
    });
    if (usageAfterAward) {
      throw new Error(`Cannot safely void OIL for ${member.name ?? member.id}: OIL was deducted on a leave application after this award. Change the expiry date instead, or reconcile the ledger first.`);
    }
  }

  const amountsByMember = new Map<string, number>();
  for (const credit of credits) amountsByMember.set(
    String(credit.memberId),
    Math.round(((amountsByMember.get(String(credit.memberId)) ?? 0) + Number(credit.remaining)) * 100) / 100,
  );
  const tx: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [];
  for (const credit of credits) {
    tx.push({ Update: {
      TableName: OIL_CREDIT_TABLE, Key: { id: credit.id },
      UpdateExpression: "SET remaining = :zero, voidedAt = :now, updatedAt = :now",
      ConditionExpression: "remaining = :remaining AND expiryDate = :expiry AND attribute_not_exists(voidedAt)",
      ExpressionAttributeValues: {
        ":zero": 0, ":now": new Date().toISOString(),
        ":remaining": credit.remaining, ":expiry": credit.expiryDate,
      },
    } });
  }
  for (const [memberId, amount] of amountsByMember) {
    const member = memberCache.get(memberId)!;
    const oil = Number(member.oil ?? 0), al = Number(member.al ?? 0), phol = Number(member.phol ?? 0);
    if (![oil, al, phol].every(v => Number.isFinite(v) && v >= 0) || oil + 0.000001 < amount) {
      throw new Error(`Cannot safely update OIL balance for ${member.name ?? memberId}; refresh balances and reconcile manually.`);
    }
    const nextOil = Math.round((oil - amount) * 100) / 100;
    const total = Math.round((nextOil + al + phol) * 100) / 100;
    tx.push({ Update: {
      TableName: MEMBER_TABLE, Key: { id: memberId },
      UpdateExpression: "SET oil = :oil, totalLeaveBalance = :total, totalDuties = :duties, updatedAt = :now",
      ConditionExpression: "(attribute_not_exists(oil) OR oil = :oldOil) AND updatedAt = :oldUpdated",
      ExpressionAttributeValues: {
        ":oil": nextOil, ":total": total, ":duties": Math.round((total / 2) * 100) / 100,
        ":now": new Date().toISOString(), ":oldOil": oil, ":oldUpdated": member.updatedAt,
      },
    } });
  }
  if (tx.length > 100) throw new Error("Too many transaction operations; select fewer awards.");
  await db.send(new TransactWriteCommand({ TransactItems: tx }));
  return { message: `Voided ${credits.length} OIL award(s); unused OIL was removed from personnel balances. The award records were retained for audit.` };
};
