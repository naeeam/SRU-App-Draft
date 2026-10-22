import type { Schema } from "../../data/resource";
import { randomBytes, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { assertKahGroups, validatePersonnel, type PersonnelInput } from "./validation";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

function temporaryPassword() {
  // Guaranteed upper/lower/digit/symbol with 24 additional random characters.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  return "Aa7!" + Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function callerGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(",").map(v => v.trim());
  return [];
}

export const handler: Schema["createPersonnelAccount"]["functionHandler"] = async event => {
  if (!MEMBER_TABLE || !USER_POOL_ID) throw new Error("Personnel management is not configured.");
  if (!event.identity || !("claims" in event.identity)) throw new Error("Authentication required.");
  assertKahGroups(callerGroups(event.identity.claims["cognito:groups"]));

  const input = event.arguments as unknown as PersonnelInput;
  const { errors, value } = validatePersonnel(input);
  if (errors.length) throw new Error(errors.join(" "));

  // Check the Member table as well as Cognito. Cognito's username is the
  // normalized email, so a second account with that username cannot be created.
  let cursor: Record<string, unknown> | undefined;
  do {
    const scan = await db.send(new ScanCommand({
      TableName: MEMBER_TABLE,
      FilterExpression: "#email = :email",
      ExpressionAttributeNames: { "#email": "email" },
      ExpressionAttributeValues: { ":email": value.email },
      ProjectionExpression: "id",
      ExclusiveStartKey: cursor,
    }));
    if ((scan.Items?.length ?? 0) > 0) throw new Error("A Member record already uses this email.");
    cursor = scan.LastEvaluatedKey;
  } while (cursor);

  const password = temporaryPassword();
  let username: string | undefined;
  try {
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: value.email,
      TemporaryPassword: password,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: value.email },
        { Name: "name", Value: value.name },
      ],
    }));
    username = created.User?.Username ?? value.email;
    const sub = created.User?.Attributes?.find(attr => attr.Name === "sub")?.Value;
    if (!sub) throw new Error("Cognito did not return a user sub.");

    const groups = [
      value.rank,
      ...(value.driver ? ["DRIVER"] : []),
      ...(value.appointment ? [`APPT_${value.appointment}`] : []),
    ];
    for (const group of groups) {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID, Username: username, GroupName: group,
      }));
    }

    const now = new Date().toISOString();
    const memberId = randomUUID();
    await db.send(new PutCommand({
      TableName: MEMBER_TABLE,
      Item: {
        id: memberId,
        name: value.name,
        email: value.email,
        phone: value.phone,
        rank: value.rank,
        driver: value.driver,
        appointment: value.appointment || null,
        al: value.al,
        oil: value.oil,
        phol: value.phol,
        totalLeaveBalance: value.totalLeaveBalance,
        totalDuties: value.totalDuties,
        mcCount: value.mcCount,
        userId: sub,
        createdAt: now,
        updatedAt: now,
        __typename: "Member",
      },
      ConditionExpression: "attribute_not_exists(id)",
    }));
    // Password is returned only in the authenticated mutation response.
    // Never log it or persist it. The UI must show it once.
    return { memberId, email: value.email, temporaryPassword: password };
  } catch (error) {
    if (username) {
      try {
        await cognito.send(new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID, Username: username,
        }));
      } catch {
        throw new Error("Account setup failed and automatic cleanup failed. Contact an administrator before retrying.");
      }
    }
    throw error;
  }
};
