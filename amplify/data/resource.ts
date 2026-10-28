import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { submitLeaveForMember } from "../functions/submit-leave-for-member/resource";
import { managePersonnel } from "../functions/manage-personnel/resource";
import { cancelLeave } from "../functions/cancel-leave/resource";
import { reviewLeave } from "../functions/review-leave/resource";
import { attachScreenshot } from "../functions/attach-screenshot/resource";
import { updatePersonnelGroups } from "../functions/update-personnel-groups/resource";
import { awardOil } from "../functions/award-oil/resource";

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
      oilExpiryDate: a.date(), // Optional: older leave records display "No expiry".
      deductedOil: a.float(),
      deductedAl: a.float(),
      deductedPhol: a.float(),
      balanceRefunded: a.boolean(),
    })
    .authorization((allow) => [
      // 1. Owner can create, read, update, and delete their own leave
      allow.owner().to(["read"]),
      // 2. Everyone logged in can read
      allow.authenticated().to(["read"]),
      // 3. Approvers can read and update (for approving/rejecting)
      allow.groups(approvers).to(["read", "update", "delete"]),
    ]),

  // Individual OIL awards. Legacy Member.oil remains unchanged until migrated.
  OilCredit: a
    .model({
      memberId: a.id().required(),
      amount: a.float().required(),
      remaining: a.float().required(),
      expiryDate: a.date().required(),
      awardedAt: a.datetime().required(),
      awardedBy: a.string().required(),
    })
    .secondaryIndexes((index) => [index("memberId")])
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.groups(approvers).to(["create", "read"]),
    ]),

  // Records the exact OIL credits reserved by each leave request.
  OilAllocation: a
    .model({
      leaveId: a.id().required(),
      creditId: a.id().required(),
      amount: a.float().required(),
      expiryDate: a.date().required(),
    })
    .secondaryIndexes((index) => [index("leaveId")])
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.groups(approvers).to(["read"]),
    ]),

  RotaSettings: a
    .model({ strength: a.integer().required() })
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.groups(approvers).to(["create", "read", "update"]),
    ]),

  Member: a
    .model({
      name: a.string().required(),
      email: a.string().required(),
      rank: a.string(),
      phone: a.string(),
      driver: a.boolean(),
      appointment: a.string(),
      mcCount: a.integer().default(0),
      al: a.float().default(0),
      oil: a.float().default(0),
      phol: a.float().default(0),
      totalLeaveBalance: a.float().default(0),
      totalDuties: a.float().default(0),
      userId: a.string()
    })
    .authorization((allow) => [
      allow.groups(approvers).to(["create", "read", "update", "delete"]),
      allow.authenticated().to(["read"]),
      // Personnel changes are KAH-only. Do not grant owners blanket update access.
    ]),
  awardOil: a
    .mutation()
    .arguments({
      memberId: a.id().required(),
      amount: a.float().required(),
      expiryDate: a.date().required(),
      requestId: a.id().required(),
    })
    .returns(a.ref("AwardOilResult"))
    .authorization((allow) => [allow.groups(approvers)])
    .handler(a.handler.function(awardOil)),

  AwardOilResult: a.customType({ message: a.string().required() }),

  updatePersonnelGroups: a
    .mutation()
    .arguments({
      memberId: a.id().required(),
      rank: a.string().required(),
      driver: a.boolean().required(),
      appointment: a.string().required(),
    })
    .returns(a.ref("UpdatePersonnelGroupsResult"))
    .authorization((allow) => [allow.groups(approvers)])
    .handler(a.handler.function(updatePersonnelGroups)),

  UpdatePersonnelGroupsResult: a.customType({ message: a.string().required() }),

  attachLeaveScreenshot: a
    .mutation()
    .arguments({ leaveId: a.id().required(), path: a.string().required() })
    .returns(a.ref("AttachScreenshotResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(attachScreenshot)),

  AttachScreenshotResult: a.customType({ message: a.string().required() }),

  reviewLeave: a
    .mutation()
    .arguments({ leaveId: a.id().required(), status: a.string().required() })
    .returns(a.ref("ReviewLeaveResult"))
    .authorization((allow) => [allow.groups(approvers)])
    .handler(a.handler.function(reviewLeave)),

  ReviewLeaveResult: a.customType({ message: a.string().required() }),

  cancelLeave: a
    .mutation()
    .arguments({ leaveId: a.id().required() })
    .returns(a.ref("CancelLeaveResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(cancelLeave)),

  CancelLeaveResult: a.customType({ message: a.string().required() }),

  createPersonnelAccount: a
    .mutation()
    .arguments({
      rank: a.string().required(),
      name: a.string().required(),
      email: a.string().required(),
      phone: a.string().required(),
      driver: a.string().required(),
      appointment: a.string().required(),
      al: a.string().required(),
      oil: a.string().required(),
      phol: a.string().required(),
      total_leave_balance: a.string().required(),
      total_duties: a.string().required(),
      mc_count: a.string().required(),
    })
    .returns(a.ref("PersonnelAccountResult"))
    .authorization((allow) => [allow.groups(approvers)])
    .handler(a.handler.function(managePersonnel)),

  PersonnelAccountResult: a.customType({
    memberId: a.id().required(),
    email: a.string().required(),
    temporaryPassword: a.string().required(),
  }),

  submitLeaveForMember: a
    .mutation()
    .arguments({
      memberId: a.id().required(),
      leaveType: a.string().required(),
      startDate: a.date().required(),
      endDate: a.date().required(),
      startTime: a.string(),
      endTime: a.string(),
      reason: a.string(),
      requestId: a.id().required(),
    })
    .returns(a.ref("DelegatedLeaveResult"))
    .authorization((allow) => [
      allow.authenticated(),
    ])
    .handler(a.handler.function(submitLeaveForMember)),

  DelegatedLeaveResult: a.customType({
    leaveId: a.id().required(),
    message: a.string().required(),
  }),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});