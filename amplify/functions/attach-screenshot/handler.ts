import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.LEAVE_TABLE_NAME!;

export const handler: Schema["attachLeaveScreenshot"]["functionHandler"] = async event => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Sign in required.");
  const sub = String(event.identity.claims.sub ?? "");
  if (!sub) throw new Error("Missing identity.");
  const { leaveId, path } = event.arguments;
  if (!path.startsWith(`screenshots/${leaveId}/`) || path.length > 512 || path.includes("..")) {
    throw new Error("Invalid screenshot path.");
  }
  const current = (await db.send(new GetCommand({
    TableName: TABLE, Key: { id: leaveId }, ConsistentRead: true,
  }))).Item;
  if (!current) throw new Error("Leave not found.");
  if (!String(current.owner ?? "").split("::").includes(sub)) {
    throw new Error("You can only attach screenshots to your own leave.");
  }
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: { id: leaveId },
    UpdateExpression: "SET screenshotPath = :path, updatedAt = :now",
    ConditionExpression: "#owner = :owner AND updatedAt = :oldUpdated",
    ExpressionAttributeNames: { "#owner": "owner" },
    ExpressionAttributeValues: {
      ":owner": current.owner, ":oldUpdated": current.updatedAt,
      ":path": path, ":now": new Date().toISOString(),
    },
  }));
  return { message: "Screenshot attached." };
};
