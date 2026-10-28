
import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { storage } from "./storage/resource";

import { submitLeaveForMember } from "./functions/submit-leave-for-member/resource";
import { managePersonnel } from "./functions/manage-personnel/resource";
import { cancelLeave } from "./functions/cancel-leave/resource";
import { reviewLeave } from "./functions/review-leave/resource";
import { attachScreenshot } from "./functions/attach-screenshot/resource";
import { updatePersonnelGroups } from "./functions/update-personnel-groups/resource";
import { awardOil } from "./functions/award-oil/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  submitLeaveForMember,
  managePersonnel,
  cancelLeave,
  reviewLeave,
  attachScreenshot,
  updatePersonnelGroups,
  awardOil,
});

// DynamoDB tables
const leaveTable =
  backend.data.resources.tables["Leave"];

const memberTable =
  backend.data.resources.tables["Member"];

// Lambda function
const fn =
  backend.submitLeaveForMember.resources.lambda;

const cfnFunction =
  backend.submitLeaveForMember.resources.cfnResources.cfnFunction;

// DynamoDB access
leaveTable.grantReadWriteData(fn);
memberTable.grantReadWriteData(fn);

// DynamoDB transaction permission
fn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "dynamodb:TransactWriteItems",
    ],
    resources: [
      leaveTable.tableArn,
      memberTable.tableArn,
    ],
  })
);

// Cognito identity verification
fn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminListGroupsForUser",
    ],
    resources: [
      backend.auth.resources.userPool.userPoolArn,
    ],
  })
);

// Actual AWS resource identifiers
cfnFunction.addPropertyOverride(
  "Environment.Variables",
  {
    LEAVE_TABLE_NAME: leaveTable.tableName,
    MEMBER_TABLE_NAME: memberTable.tableName,
    USER_POOL_ID:
      backend.auth.resources.userPool.userPoolId,
  }
);

// KAH personnel account creation (separate from delegated leave submission).
const personnelFn = backend.managePersonnel.resources.lambda;
const personnelCfn = backend.managePersonnel.resources.cfnResources.cfnFunction;
memberTable.grantReadWriteData(personnelFn);
personnelFn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminDeleteUser",
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);
personnelCfn.addPropertyOverride("Environment.Variables", {
  MEMBER_TABLE_NAME: memberTable.tableName,
  USER_POOL_ID: backend.auth.resources.userPool.userPoolId,
});

const cancelFn = backend.cancelLeave.resources.lambda;
const cancelCfn = backend.cancelLeave.resources.cfnResources.cfnFunction;
leaveTable.grantReadWriteData(cancelFn);
memberTable.grantReadWriteData(cancelFn);
cancelFn.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:TransactWriteItems"],
  resources: [leaveTable.tableArn, memberTable.tableArn],
}));
cancelCfn.addPropertyOverride("Environment.Variables", {
  LEAVE_TABLE_NAME: leaveTable.tableName,
  MEMBER_TABLE_NAME: memberTable.tableName,
});

const reviewFn = backend.reviewLeave.resources.lambda;
const reviewCfn = backend.reviewLeave.resources.cfnResources.cfnFunction;
leaveTable.grantReadWriteData(reviewFn);
memberTable.grantReadWriteData(reviewFn);
reviewFn.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:TransactWriteItems"],
  resources: [leaveTable.tableArn, memberTable.tableArn],
}));
reviewCfn.addPropertyOverride("Environment.Variables", {
  LEAVE_TABLE_NAME: leaveTable.tableName,
  MEMBER_TABLE_NAME: memberTable.tableName,
});

const screenshotFn = backend.attachScreenshot.resources.lambda;
const screenshotCfn = backend.attachScreenshot.resources.cfnResources.cfnFunction;
leaveTable.grantReadWriteData(screenshotFn);
screenshotCfn.addPropertyOverride("Environment.Variables", {
  LEAVE_TABLE_NAME: leaveTable.tableName,
});

const groupsFn = backend.updatePersonnelGroups.resources.lambda;
const groupsCfn = backend.updatePersonnelGroups.resources.cfnResources.cfnFunction;
memberTable.grantReadWriteData(groupsFn);
groupsFn.addToRolePolicy(new PolicyStatement({
  actions: [
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminListGroupsForUser",
    "cognito-idp:AdminAddUserToGroup",
    "cognito-idp:AdminRemoveUserFromGroup",
  ],
  resources: [backend.auth.resources.userPool.userPoolArn],
}));
groupsCfn.addPropertyOverride("Environment.Variables", {
  MEMBER_TABLE_NAME: memberTable.tableName,
  USER_POOL_ID: backend.auth.resources.userPool.userPoolId,
});


// Secure OIL awards: update the individual credit and aggregate Member balance atomically.
const awardOilFn = backend.awardOil.resources.lambda;
const awardOilCfn = backend.awardOil.resources.cfnResources.cfnFunction;
const oilCreditTable = backend.data.resources.tables["OilCredit"];
oilCreditTable.grantReadWriteData(awardOilFn);
memberTable.grantReadWriteData(awardOilFn);
awardOilFn.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:TransactWriteItems"],
  resources: [oilCreditTable.tableArn, memberTable.tableArn],
}));
awardOilCfn.addPropertyOverride("Environment.Variables", {
  MEMBER_TABLE_NAME: memberTable.tableName,
  OIL_CREDIT_TABLE_NAME: oilCreditTable.tableName,
});
