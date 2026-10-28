import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient, AdminGetUserCommand, AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { assertKahGroups } from "../manage-personnel/validation";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.MEMBER_TABLE_NAME!;
const POOL = process.env.USER_POOL_ID!;
const RANKS = ["LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP"];
const APPOINTMENTS = ["FF", "SC", "RC", "DRC"];
const MANAGED = new Set([...RANKS, "DRIVER", ...APPOINTMENTS.map(a => `APPT_${a}`)]);

export const handler: Schema["updatePersonnelGroups"]["functionHandler"] = async event => {
  if (!event.identity || !("claims" in event.identity)) throw new Error("Authentication required.");
  const raw = event.identity.claims["cognito:groups"];
  assertKahGroups(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map(v => v.trim()) : []);
  const { memberId, rank, driver, appointment, oic } = event.arguments;
  if (!RANKS.includes(rank) || !["", ...APPOINTMENTS].includes(appointment)) {
    throw new Error("Invalid rank or appointment.");
  }
  const member = (await db.send(new GetCommand({
    TableName: TABLE, Key: { id: memberId }, ConsistentRead: true,
  }))).Item;
  if (!member?.userId) throw new Error("Member is not linked to Cognito.");
  const sub = String(member.userId);
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: sub }));
  const verifiedSub = user.UserAttributes?.find(v => v.Name === "sub")?.Value;
  const verifiedEmail = user.UserAttributes?.find(v => v.Name === "email")?.Value;
  if (verifiedSub !== sub || verifiedEmail?.toLowerCase() !== String(member.email).toLowerCase()) {
    throw new Error("Member and Cognito identity mismatch.");
  }
  const username = user.Username ?? sub;
  const groupsResult = await cognito.send(new AdminListGroupsForUserCommand({
    UserPoolId: POOL, Username: username,
  }));
  const original = new Set((groupsResult.Groups ?? []).map(v => v.GroupName ?? ""));
  const desired = new Set([
    rank, ...(driver ? ["DRIVER"] : []),
    ...(appointment ? [`APPT_${appointment}`] : []),
    ...(oic ? ["OIC"] : []),
  ]);
  const remove = [...original].filter(g => MANAGED.has(g) && !desired.has(g));
  const add = [...desired].filter(g => !original.has(g));
  const completed: { group: string; action: "add" | "remove" }[] = [];
  try {
    for (const group of add) {
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: username, GroupName: group }));
      completed.push({ group, action: "add" });
    }
    for (const group of remove) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL, Username: username, GroupName: group }));
      completed.push({ group, action: "remove" });
    }
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { id: memberId },
      UpdateExpression: "SET #rank = :rank, driver = :driver, appointment = :appointment, updatedAt = :now",
      ConditionExpression: "userId = :sub AND updatedAt = :oldUpdated",
      ExpressionAttributeNames: { "#rank": "rank" },
      ExpressionAttributeValues: {
        ":rank": rank, ":driver": driver, ":appointment": appointment || null,
        ":sub": sub, ":oldUpdated": member.updatedAt, ":now": new Date().toISOString(),
      },
    }));
  } catch {
    let rollbackFailed = false;
    for (const step of completed.reverse()) {
      try {
        if (step.action === "add") {
          await cognito.send(new AdminRemoveUserFromGroupCommand({
            UserPoolId: POOL, Username: username, GroupName: step.group,
          }));
        } else {
          await cognito.send(new AdminAddUserToGroupCommand({
            UserPoolId: POOL, Username: username, GroupName: step.group,
          }));
        }
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error("Personnel update failed and group rollback was incomplete. Contact an administrator.");
    throw new Error("Personnel update failed; Cognito changes were rolled back.");
  }
  return { message: oic
    ? "Cognito groups and Member role updated; OIC group access added."
    : "Cognito groups and Member role updated." };
};
