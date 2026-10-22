import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { afterRefund, afterDeduction, planDeduction, sumOf, totalsOf } from "../../../app/lib/Balance";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LEAVE_TABLE = process.env.LEAVE_TABLE_NAME!;
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;
type Status = "APPROVED" | "REJECTED" | "PENDING";

export const handler: Schema["reviewLeave"]["functionHandler"] = async event => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Sign in required.");
  const claims = event.identity.claims;
  const raw = claims["cognito:groups"];
  const groups = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map(v => v.trim()) : [];
  if (!groups.some(v => v === "LTA" || v === "WO2")) throw new Error("KAH only.");
  const target = event.arguments.status as Status;
  if (!["APPROVED", "REJECTED", "PENDING"].includes(target)) throw new Error("Invalid status.");
  const leave = (await db.send(new GetCommand({
    TableName: LEAVE_TABLE, Key: { id: event.arguments.leaveId }, ConsistentRead: true,
  }))).Item;
  if (!leave) throw new Error("Leave not found.");
  const previous = String(leave.status ?? "PENDING");
  const wasRefunded = Boolean(leave.balanceRefunded);
  const isReject = target === "REJECTED";
  const changeBalance = isReject !== wasRefunded;
  const tx: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [];
  const leaveValues: Record<string, unknown> = {
    ":target": target, ":now": new Date().toISOString(),
    ":oldUpdated": leave.updatedAt, ":refunded": isReject,
  };
  let deduction = {
    oil: Number(leave.deductedOil ?? 0), al: Number(leave.deductedAl ?? 0),
    phol: Number(leave.deductedPhol ?? 0),
  };
  if (Object.values(deduction).some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid deduction.");
  const needed = sumOf(deduction);
  if (changeBalance && needed > 0) {
    const sub = String(leave.owner ?? "").split("::").find(v => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(v));
    if (!sub) throw new Error("Leave has no valid Cognito sub.");
    let cursor: Record<string, unknown> | undefined;
    const matches: Record<string, any>[] = [];
    do {
      const response = await db.send(new ScanCommand({
        TableName: MEMBER_TABLE, FilterExpression: "userId = :sub",
        ExpressionAttributeValues: { ":sub": sub }, ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }));
      matches.push(...(response.Items ?? []));
      cursor = response.LastEvaluatedKey;
    } while (cursor);
    if (matches.length !== 1) throw new Error("Exactly one linked Member record is required.");
    const member = matches[0];
    const old = { oil: Number(member.oil ?? 0), al: Number(member.al ?? 0), phol: Number(member.phol ?? 0) };
    if (Object.values(old).some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid Member balance.");
    const next = isReject ? afterRefund(old, deduction) : afterDeduction(old, planDeduction(old, needed).take);
    if (!isReject) {
      const plan = planDeduction(old, needed);
      if (plan.shortfall > 0) throw new Error("Insufficient leave balance to restore request.");
      deduction = plan.take;
    }
    const totals = totalsOf(next);
    tx.push({ Update: {
      TableName: MEMBER_TABLE, Key: { id: member.id },
      UpdateExpression: "SET oil = :oil, al = :al, phol = :phol, totalLeaveBalance = :total, totalDuties = :duties, updatedAt = :now",
      ConditionExpression: "userId = :sub AND updatedAt = :memberUpdated",
      ExpressionAttributeValues: {
        ":sub": sub, ":memberUpdated": member.updatedAt,
        ":oil": next.oil, ":al": next.al, ":phol": next.phol,
        ":total": totals.totalLeaveBalance, ":duties": totals.totalDuties, ":now": leaveValues[":now"],
      },
    } });
  }
  const reviewedBy = target === "PENDING" ? "" : String(claims.email ?? claims.sub ?? "");
  tx.push({ Update: {
    TableName: LEAVE_TABLE, Key: { id: leave.id },
    UpdateExpression: "SET #status = :target, reviewedBy = :reviewer, reviewedAt = :now, balanceRefunded = :refunded, updatedAt = :now, deductedOil = :oil, deductedAl = :al, deductedPhol = :phol",
    ConditionExpression: "updatedAt = :oldUpdated AND (attribute_not_exists(#status) OR #status = :previous)",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ...leaveValues, ":previous": previous, ":reviewer": reviewedBy,
      ":oil": deduction.oil, ":al": deduction.al, ":phol": deduction.phol,
    },
  } });
  await db.send(new TransactWriteCommand({ TransactItems: tx }));
  return { message: "Leave decision and balance updated." };
};
