
import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { storage } from "./storage/resource";

import { submitLeaveForMember } from "./functions/submit-leave-for-member/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  submitLeaveForMember,
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
