import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

// KAH (Key Appointment Holders): LTA and WO2 can approve or reject leave.
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
      startTime: a.string(), // "HH:MM", only used for Time off
      endTime: a.string(), // "HH:MM", only used for Time off
      isDriver: a.boolean(), // copied from the applicant's account when they apply
      appointment: a.string(), // FF, SC, RC or DRC, copied from the applicant's account
      reason: a.string(),

      // S3 path reference. The owner needs "create" here too, because a field with its own
      // rules is checked separately when the request is first submitted.
      screenshotPath: a
        .string()
        .authorization((allow) => [
          allow.owner().to(["create", "read", "update", "delete"]),
          allow.authenticated().to(["read"]),
          allow.groups(approvers).to(["read", "update"]),
        ]),

      // Only approvers can write these three fields; everyone signed in can read them.
      // The owner is only allowed "delete" here, so they can cancel their own request
      // but can never set or change an approval.
      // Empty status means PENDING (the app handles this).
      status: a
        .string()
        .authorization((allow) => [
          allow.authenticated().to(["read"]),
          allow.groups(approvers).to(["read", "update"]),
          allow.owner().to(["delete"]),
        ]),
      reviewedBy: a
        .string()
        .authorization((allow) => [
          allow.authenticated().to(["read"]),
          allow.groups(approvers).to(["read", "update"]),
          allow.owner().to(["delete"]),
        ]),
      reviewedAt: a
        .datetime()
        .authorization((allow) => [
          allow.authenticated().to(["read"]),
          allow.groups(approvers).to(["read", "update"]),
          allow.owner().to(["delete"]),
        ]),
    })
    .authorization((allow) => [
      allow.owner().to(["create", "read", "update", "delete"]), // the applicant: apply, view, edit, cancel their own
      allow.authenticated().to(["read"]), // everyone sees the dashboard numbers
      allow.groups(approvers).to(["read", "update"]), // approve / reject
    ]),

  // One row per user, matched to their account by login email.
  // AL, OIL and PHOL are entered; Total Leave Balance and Total Duties are stored too,
  // and are worked out as:  Total Leave Balance = AL + OIL + PHOL,  Total Duties = Total Leave Balance / 2.
  Member: a
    .model({
      name: a.string().required(), // e.g. "SGT1 Ahmad Tan"
      email: a.string().required(), // the login email, in lowercase. One row per user.
      rank: a.string(), // LTA, WO2, SGT1, SGT2, CPL or LCP, saved by the import script
      // The numbers are optional so an older row with a missing value can never stop the whole list loading.
      mcCount: a.integer().default(0), // number of MCs (medical certificates), whole number
      al: a.float().default(0),
      oil: a.float().default(0),
      phol: a.float().default(0),
      totalLeaveBalance: a.float().default(0),
      totalDuties: a.float().default(0),
    })
    .authorization((allow) => [
      allow.groups(approvers).to(["create", "read", "update", "delete"]), // KAH manage the roster
      allow.authenticated().to(["read"]), // others may read balances
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});