import { defineFunction } from "@aws-amplify/backend";

export const awardOil = defineFunction({
  name: "award-oil",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  environment: {
    MEMBER_TABLE_NAME: "",
    OIL_CREDIT_TABLE_NAME: "",
  },
});
