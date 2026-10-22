import { defineFunction } from "@aws-amplify/backend";

export const cancelLeave = defineFunction({
  name: "cancel-leave",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  environment: {
    LEAVE_TABLE_NAME: "",
    MEMBER_TABLE_NAME: "",
  },
});
