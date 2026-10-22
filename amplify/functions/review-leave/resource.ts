import { defineFunction } from "@aws-amplify/backend";

export const reviewLeave = defineFunction({
  name: "review-leave",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  environment: { LEAVE_TABLE_NAME: "", MEMBER_TABLE_NAME: "" },
});
