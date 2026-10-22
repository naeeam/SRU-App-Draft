import { defineFunction } from "@aws-amplify/backend";

export const updatePersonnelGroups = defineFunction({
  name: "update-personnel-groups",
  entry: "./handler.ts",
  resourceGroupName: "data",
  environment: { MEMBER_TABLE_NAME: "", USER_POOL_ID: "" },
});
