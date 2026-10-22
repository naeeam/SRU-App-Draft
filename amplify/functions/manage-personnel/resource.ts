import { defineFunction } from "@aws-amplify/backend";

export const managePersonnel = defineFunction({
  name: "manage-personnel",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 60,
  environment: {
    MEMBER_TABLE_NAME: "",
    USER_POOL_ID: "",
  },
});
