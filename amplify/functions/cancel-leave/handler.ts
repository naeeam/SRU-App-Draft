import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterRefund, totalsOf } from "../../../app/lib/Balance";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LEAVE_TABLE = process.env.LEAVE_TABLE_NAME!;
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;

export const handler: Schema["cancelLeave"]["functionHandler"] = async (event) => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Sign in required.");
  const sub = String(event.identity.claims.sub ?? "");
  if (!sub) throw new Error("Missing user identity.");
  const id = event.arguments.leaveId;
  const leave = (await db.send(new GetCommand({
    TableName: LEAVE_TABLE, Key: { id }, ConsistentRead: true,
  }))).Item;
  if (!leave) throw new Error("Leave not found.");

  // Amplify owner values may contain a Cognito username and sub separated by ::.
  // Only trust the authenticated sub, never a member id supplied by the client.
  const ownerParts = String(leave.owner ?? "").split("::");
  if (!ownerParts.includes(sub)) throw new Error("You may only cancel your own leave.");
  if ((leave.status ?? "PENDING") !== "PENDING") {
    throw new Error("Only pending leave can be cancelled.");
  }

  const taken = {
    oil: Number(leave.deductedOil ?? 0),
    al: Number(leave.deductedAl ?? 0),
    phol: Number(leave.deductedPhol ?? 0),
  };
  if (Object.values(taken).some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error("Invalid recorded deduction.");
  }

  const needsRefund = !leave.balanceRefunded && Object.values(taken).some(v => v > 0);
  const tx: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [];
  if (needsRefund) {
    const matches = await db.send(new ScanCommand({
      TableName: MEMBER_TABLE,
      FilterExpression: "userId = :sub",
      ExpressionAttributeValues: { ":sub": sub },
      ConsistentRead: true,
    }));
    if (matches.LastEvaluatedKey) throw new Error("Member lookup incomplete; retry through support.");
    if (matches.Items?.length !== 1) throw new Error("Exactly one linked Member record is required.");
    const member = matches.Items[0];
    const original = {
      oil: Number(member.oil ?? 0), al: Number(member.al ?? 0), phol: Number(member.phol ?? 0),
    };
    if (Object.values(original).some(v => !Number.isFinite(v) || v < 0)) {
      throw new Error("Invalid existing balance.");
    }
    const next = afterRefund(original, taken);
    const totals = totalsOf(next);
    tx.push({ Update: {
      TableName: MEMBER_TABLE, Key: { id: member.id },
      UpdateExpression: "SET oil = :oil, al = :al, phol = :phol, totalLeaveBalance = :total, totalDuties = :duties, updatedAt = :now",
      ConditionExpression: "userId = :sub AND (attribute_not_exists(oil) OR oil = :oldOil) AND (attribute_not_exists(al) OR al = :oldAl) AND (attribute_not_exists(phol) OR phol = :oldPhol)",
      ExpressionAttributeValues: {
        ":sub": sub, ":oil": next.oil, ":al": next.al, ":phol": next.phol,
        ":total": totals.totalLeaveBalance, ":duties": totals.totalDuties,
        ":oldOil": original.oil, ":oldAl": original.al, ":oldPhol": original.phol,
        ":now": new Date().toISOString(),
      },
    } });
  }
  tx.push({ Delete: {
    TableName: LEAVE_TABLE, Key: { id },
    ConditionExpression: "#owner = :owner AND (attribute_not_exists(#status) OR #status = :pending) AND (attribute_not_exists(balanceRefunded) OR balanceRefunded = :refunded) AND updatedAt = :updated",
    ExpressionAttributeNames: { "#owner": "owner", "#status": "status" },
    ExpressionAttributeValues: {
      ":owner": leave.owner, ":pending": "PENDING",
      ":refunded": Boolean(leave.balanceRefunded),
      ":updated": leave.updatedAt,
    },
  } });
  await db.send(new TransactWriteCommand({ TransactItems: tx }));
  return { message: "Leave cancelled and any balance refund applied." };
};
