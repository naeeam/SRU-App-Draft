import { defineFunction } from "@aws-amplify/backend";

export const manageOilCredits = defineFunction({
  name: "manage-oil-credits",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  environment: {
    MEMBER_TABLE_NAME: "",
    OIL_CREDIT_TABLE_NAME: "",
    OIL_ALLOCATION_TABLE_NAME: "",
    LEAVE_TABLE_NAME: "",
  },
});
