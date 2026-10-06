import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const approvers = ["LTA", "WO2"];

const schema = a.schema({
  Leave: a
    .model({
      applicantName: a.string().required(),
      leaveType: a.enum([
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
      ]),
      startDate: a.date().required(),
      endDate: a.date().required(),
      startTime: a.string(),
      endTime: a.string(),
      isDriver: a.boolean(),
      appointment: a.string(),
      reason: a.string(),
      screenshotPath: a.string(),

      // Approval status fields
      status: a.string(),
      reviewedBy: a.string(),
      reviewedAt: a.datetime(),
    })
    .authorization((allow) => [
      // 1. Owner can create, read, update, and delete their own leave
      allow.owner().to(["create", "read", "update", "delete"]),
      // 2. Everyone logged in can read
      allow.authenticated().to(["read"]),
      // 3. Approvers can read and update (for approving/rejecting)
      allow.groups(approvers).to(["read", "update", "delete"]),
    ]),

  Member: a
    .model({
      name: a.string().required(),
      email: a.string().required(),
      rank: a.string(),
      mcCount: a.integer().default(0),
      al: a.float().default(0),
      oil: a.float().default(0),
      phol: a.float().default(0),
      totalLeaveBalance: a.float().default(0),
      totalDuties: a.float().default(0),
    })
    .authorization((allow) => [
      allow.groups(approvers).to(["create", "read", "update", "delete"]),
      allow.authenticated().to(["read"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});