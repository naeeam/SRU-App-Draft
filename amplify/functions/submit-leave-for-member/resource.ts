
import { defineFunction } from "@aws-amplify/backend";

export const submitLeaveForMember = defineFunction({
  name: "submit-leave-for-member",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  environment: {
    LEAVE_TABLE_NAME: "",
    MEMBER_TABLE_NAME: "",
    USER_POOL_ID: "",
  },
});
