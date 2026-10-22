import { defineFunction } from "@aws-amplify/backend";

export const attachScreenshot = defineFunction({
  name: "attach-screenshot",
  entry: "./handler.ts",
  resourceGroupName: "data",
  environment: { LEAVE_TABLE_NAME: "" },
});
