import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;
const OIL_CREDIT_TABLE = process.env.OIL_CREDIT_TABLE_NAME!;

function singaporeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export const handler: Schema["awardOil"]["functionHandler"] = async event => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Sign in required.");
  const claims = event.identity.claims;
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups) ? rawGroups.map(String) :
    typeof rawGroups === "string" ? rawGroups.split(",").map(v => v.trim()) : [];
  if (!groups.some(group => group === "LTA" || group === "WO2")) throw new Error("KAH only.");

  const { memberId, amount, expiryDate, requestId } = event.arguments;
  const value = Number(amount);
  if (!memberId || !requestId || !Number.isFinite(value) || value <= 0 ||
      Math.round(value * 100) !== value * 100) {
    throw new Error("Enter a valid member, request ID and positive OIL amount (maximum two decimal places).");
  }
  if (!validDate(expiryDate) || expiryDate < singaporeDate()) {
    throw new Error("Expiry date must be today or a future date in Singapore.");
  }

  // Idempotency: a retry with the same request ID must never award the credit twice.
  const existingCredit = await db.send(new GetCommand({
    TableName: OIL_CREDIT_TABLE, Key: { id: requestId }, ConsistentRead: true,
  }));
  if (existingCredit.Item) {
    const existing = existingCredit.Item;
    if (existing.memberId !== memberId ||
        Math.abs(Number(existing.amount) - value) > 0.000001 ||
        existing.expiryDate !== expiryDate) {
      throw new Error("This request ID has already been used for a different OIL award.");
    }
    return { message: "OIL award was already recorded; no duplicate balance change was made." };
  }

  const result = await db.send(new GetCommand({
    TableName: MEMBER_TABLE, Key: { id: memberId }, ConsistentRead: true,
  }));
  const member = result.Item;
  if (!member) throw new Error("Selected member does not exist.");

  const oil = Number(member.oil ?? 0);
  const al = Number(member.al ?? 0);
  const phol = Number(member.phol ?? 0);
  if ([oil, al, phol].some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error("Member has an invalid leave balance.");
  }
  const nextOil = Math.round((oil + value) * 100) / 100;
  const total = Math.round((nextOil + al + phol) * 100) / 100;
  const duties = Math.round((total / 2) * 100) / 100;
  const now = new Date().toISOString();
  const credit = {
    id: requestId, memberId, amount: value, remaining: value, expiryDate,
    awardedAt: now, awardedBy: String(claims.email ?? claims.sub ?? "KAH"),
    createdAt: now, updatedAt: now, __typename: "OilCredit",
  };

  const conditions = [
    "(attribute_not_exists(oil) OR oil = :oldOil)",
    "(attribute_not_exists(al) OR al = :oldAl)",
    "(attribute_not_exists(phol) OR phol = :oldPhol)",
  ];
  const values: Record<string, unknown> = {
    ":oldOil": oil, ":oldAl": al, ":oldPhol": phol,
    ":oil": nextOil, ":total": total, ":duties": duties, ":now": now,
  };
  if (member.updatedAt !== undefined) {
    conditions.push("updatedAt = :oldUpdated");
    values[":oldUpdated"] = member.updatedAt;
  } else {
    conditions.push("attribute_not_exists(updatedAt)");
  }

  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: OIL_CREDIT_TABLE, Item: credit,
            ConditionExpression: "attribute_not_exists(id)",
          },
        },
        {
          Update: {
            TableName: MEMBER_TABLE, Key: { id: memberId },
            UpdateExpression: "SET oil = :oil, totalLeaveBalance = :total, totalDuties = :duties, updatedAt = :now",
            ConditionExpression: conditions.join(" AND "),
            ExpressionAttributeValues: values,
          },
        },
      ],
    }));
  } catch (error) {
    // Two concurrent retries can both initially see no credit. If the other
    // request committed first, treat this request as successful only when the
    // stored credit exactly matches the same idempotency key and award details.
    const retry = await db.send(new GetCommand({
      TableName: OIL_CREDIT_TABLE, Key: { id: requestId }, ConsistentRead: true,
    }));
    const stored = retry.Item;
    if (stored && stored.memberId === memberId &&
        Math.abs(Number(stored.amount) - value) <= 0.000001 &&
        stored.expiryDate === expiryDate) {
      return { message: "OIL award was already recorded; no duplicate balance change was made." };
    }
    throw error;
  }
  return { message: "OIL award recorded and member leave balance updated." };
};
