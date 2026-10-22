
import type { Schema } from "../../data/resource";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import {
    CognitoIdentityProviderClient,
    AdminGetUserCommand,
    AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import {
    dutyDaysBetween,
    isDutyDay,
    addDays,
} from "../../../app/lib/dates";

import {
    DEDUCTS_BALANCE,
    LEAVE_DAYS_PER_DUTY,
    planDeduction,
    afterDeduction,
    totalsOf,
} from "../../../app/lib/Balance";

const db = DynamoDBDocumentClient.from(
    new DynamoDBClient({})
);

const cognito = new CognitoIdentityProviderClient({});

const LEAVE_TABLE = process.env.LEAVE_TABLE_NAME!;
const MEMBER_TABLE = process.env.MEMBER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

if (!LEAVE_TABLE || !MEMBER_TABLE || !USER_POOL_ID) {
    throw new Error(
        "Missing AWS configuration: DynamoDB table names or Cognito User Pool ID."
    );
}

const ALLOWED_GROUPS = new Set(["LTA", "WO2", "OIC"]);

const LEAVE_TYPES = new Set([
    "VACATION",
    "OVERSEAS_VACATION",
    "SICK",
    "HOSPITALISATION",
    "ON_COURSE",
    "MARCHING",
    "CHILDCARE",
    "EMERGENCY",
    "TIME_OFF",
    "OTHERS",
]);

const RANKS = [
    "LTA",
    "WO2",
    "SGT1",
    "SGT2",
    "CPL",
    "LCP",
];

const APPOINTMENTS = ["FF", "SC", "RC", "DRC"];

export const handler: Schema["submitLeaveForMember"]["functionHandler"] =
    async (event) => {
        const identity = event.identity;

        if (!identity || !("claims" in identity)) {
            throw new Error("Authentication required.");
        }

        const claims = identity.claims;

        const rawGroups = claims["cognito:groups"];

        const groups = Array.isArray(rawGroups)
            ? rawGroups.map(String)
            : typeof rawGroups === "string"
                ? rawGroups.split(",").map((g) => g.trim())
                : [];

        const canSubmitForOthers = groups.some((g) => ALLOWED_GROUPS.has(g));
        const callerSub = String(claims.sub ?? "");
        if (!callerSub) throw new Error("Missing caller identity.");

        const {
            memberId,
            leaveType,
            startDate,
            endDate,
            startTime,
            endTime,
            reason,
            requestId,
        } = event.arguments;

        if (
            !memberId ||
            !requestId ||
            !leaveType ||
            !LEAVE_TYPES.has(leaveType)
        ) {
            throw new Error("Invalid leave request.");
        }

        const datePattern = /^\d{4}-\d{2}-\d{2}$/;

        const validDate = (value: string) =>
            datePattern.test(value) &&
            !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
            new Date(`${value}T00:00:00Z`)
                .toISOString()
                .slice(0, 10) === value;

        if (
            !validDate(startDate) ||
            !validDate(endDate) ||
            endDate < startDate
        ) {
            throw new Error("Invalid leave dates.");
        }

        const span =
            (Date.parse(`${endDate}T00:00:00Z`) -
                Date.parse(`${startDate}T00:00:00Z`)) /
            86400000;

        if (span > 399) {
            throw new Error("Leave date range is too long.");
        }

        const isTimeOff = leaveType === "TIME_OFF";

        if (isTimeOff) {
            const validTime = (t: string | null | undefined) =>
                !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

            if (
                !isDutyDay(startDate) ||
                endDate > addDays(startDate, 1) ||
                !validTime(startTime) ||
                !validTime(endTime) ||
                (startDate === endDate && endTime! <= startTime!)
            ) {
                throw new Error("Invalid time-off dates or times.");
            }
        } else if (!isDutyDay(startDate) || !isDutyDay(endDate)) {
            throw new Error("Leave must use duty dates.");
        }

        // Retrieve the selected member from DynamoDB.
        const memberResult = await db.send(
            new GetCommand({
                TableName: MEMBER_TABLE,
                Key: { id: memberId },
                ConsistentRead: true,
            })
        );

        const member = memberResult.Item;

        if (!member) {
            throw new Error("Selected member does not exist.");
        }
        const isSelf = String(member.userId ?? "") === callerSub;
        if (!isSelf && !canSubmitForOthers) {
            throw new Error("Only KAH or OIC can submit leave for another member.");
        }

        const cognitoUsername = String(
            member.userId ?? ""
        ).trim();

        if (!cognitoUsername) {
            throw new Error(
                `Member "${member.name}" has no Cognito userId assigned.`
            );
        }

        // Retrieve the member's Cognito identity.
        const user = await cognito.send(
            new AdminGetUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: cognitoUsername,
            })
        );

        const userSub = user.UserAttributes?.find(
            (a) => a.Name === "sub"
        )?.Value;

        const userEmail = user.UserAttributes?.find(
            (a) => a.Name === "email"
        )?.Value;

        // Verify each identity field separately.
        // Do not proceed if any identity check fails.

        if (!userSub) {
            throw new Error(
                "Cognito sub is missing for the selected member."
            );
        }

        if (userSub.trim() !== cognitoUsername) {
            throw new Error(
                "Cognito sub does not match Member.userId."
            );
        }

        if (!user.Username) {
            throw new Error(
                "Cognito Username is missing."
            );
        }

        if (!userEmail) {
            throw new Error(
                "Cognito email is missing for the selected member."
            );
        }

        const memberEmail = String(
            member.email ?? ""
        ).trim().toLowerCase();

        const cognitoEmail = userEmail.trim().toLowerCase();

        if (!memberEmail) {
            throw new Error(
                "Selected Member record has no email address."
            );
        }

        if (memberEmail !== cognitoEmail) {
            throw new Error(
                "Member email does not match Cognito email."
            );
        }

        // Retrieve the selected member's current groups.
        const groupResult = await cognito.send(
            new AdminListGroupsForUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: user.Username,
            })
        );

        const memberGroups =
            groupResult.Groups?.map(
                (g) => g.GroupName ?? ""
            ) ?? [];

        const rank =
            RANKS.find((r) => memberGroups.includes(r)) ??
            String(member.rank ?? "");

        const isDriver = memberGroups.includes("DRIVER");

        const appointment =
            APPOINTMENTS.find((a) =>
                memberGroups.includes(`APPT_${a}`)
            ) ?? "";

        // Preserve the existing owner construction.
        // Verify this format against an existing self-created
        // Leave record before relying on delegated ownership.
        const owner = isSelf
            ? `${userSub}::${user.Username}`
            : `${user.Username}::${userSub}`;

        const days = dutyDaysBetween(startDate, endDate);

        const needed = DEDUCTS_BALANCE.includes(leaveType)
            ? days.length * LEAVE_DAYS_PER_DUTY
            : 0;

        const balance = {
            oil: Number(member.oil ?? 0),
            al: Number(member.al ?? 0),
            phol: Number(member.phol ?? 0),
        };

        if (
            Object.values(balance).some(
                (v) => !Number.isFinite(v) || v < 0
            )
        ) {
            throw new Error("Invalid member leave balance.");
        }

        const plan = planDeduction(balance, needed);

        if (plan.shortfall > 0) {
            throw new Error(
                "Selected member has insufficient leave balance."
            );
        }

        // TEMPORARY DEBUGGING
        const checkField = (
            field: "oil" | "al" | "phol"
        ) => {
            const original = member[field];
            const converted = balance[field];

            return {
                exists: Object.prototype.hasOwnProperty.call(member, field),
                type: typeof original,
                matchesConverted:
                    typeof original === "number" &&
                    original === converted,
            };
        };

        console.log("MEMBER TRANSACTION DEBUG", {
            userIdMatches:
                String(member.userId ?? "").trim() === userSub,
            oil: checkField("oil"),
            al: checkField("al"),
            phol: checkField("phol"),
        });
        const nextBalance = afterDeduction(
            balance,
            plan.take
        );

        const totals = totalsOf(nextBalance);

        const now = new Date().toISOString();

        const applicantName =
            `${rank} ${member.name}`.trim();

        const leave = {
            id: requestId,
            applicantName,
            owner,
            leaveType,
            startDate,
            endDate,
            startTime: isTimeOff ? startTime : null,
            endTime: isTimeOff ? endTime : null,
            isDriver,
            appointment: appointment || null,
            reason: reason ?? null,
            status: "PENDING",
            deductedOil: plan.take.oil,
            deductedAl: plan.take.al,
            deductedPhol: plan.take.phol,
            balanceRefunded: false,
            createdAt: now,
            updatedAt: now,
            __typename: "Leave",
        };

        const transactions: ConstructorParameters<
            typeof TransactWriteCommand
        >[0]["TransactItems"] = [
                {
                    Put: {
                        TableName: LEAVE_TABLE,
                        Item: leave,
                        ConditionExpression:
                            "attribute_not_exists(id)",
                    },
                },
            ];


        if (needed > 0) {
            const originalBalanceFields = [
                "oil",
                "al",
                "phol",
            ] as const;

            const conditionParts = ["userId = :sub"];

            const conditionValues: Record<string, unknown> = {
                ":sub": userSub,
            };

            for (const field of originalBalanceFields) {
                const placeholder = `:old_${field}`;

                if (
                    Object.prototype.hasOwnProperty.call(member, field) &&
                    member[field] !== null
                ) {
                    conditionParts.push(`${field} = ${placeholder}`);
                    conditionValues[placeholder] = member[field];
                } else if (member[field] === null) {
                    conditionParts.push(`attribute_type(${field}, :nullType)`);
                    conditionValues[":nullType"] = "NULL";
                } else {
                    conditionParts.push(`attribute_not_exists(${field})`);
                }
            }

            transactions.push({
                Update: {
                    TableName: MEMBER_TABLE,
                    Key: { id: memberId },

                    UpdateExpression:
                        "SET oil = :oil, al = :al, phol = :phol, " +
                        "totalLeaveBalance = :total, totalDuties = :duties, " +
                        "updatedAt = :now",

                    ConditionExpression: conditionParts.join(" AND "),

                    ExpressionAttributeValues: {
                        ...conditionValues,
                        ":oil": nextBalance.oil,
                        ":al": nextBalance.al,
                        ":phol": nextBalance.phol,
                        ":total": totals.totalLeaveBalance,
                        ":duties": totals.totalDuties,
                        ":now": now,
                    },
                },
            });
        }


        try {
            await db.send(
                new TransactWriteCommand({
                    TransactItems: transactions,
                })
            );
        } catch (err) {
            console.error("Delegated leave transaction failed:", err);

            const error = err as {
                name?: string;
                message?: string;
                CancellationReasons?: Array<{
                    Code?: string;
                    Message?: string;
                }>;
            };

            const reasons = error.CancellationReasons
                ?.map((reason, index) =>
                    `Operation ${index + 1}: ${reason.Code ?? "Unknown"} - ${reason.Message ?? ""}`
                )
                .join("; ");

            throw new Error(
                `DynamoDB transaction failed: ${error.name ?? "UnknownError"}` +
                (reasons ? `. ${reasons}` : "")
            );
        }

        return {
            leaveId: requestId,
            message: "Leave submitted successfully.",
        };
    };
