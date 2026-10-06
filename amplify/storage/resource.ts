import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "leaveWorkflowStorage",
  access: (allow) => ({
    "screenshots/*": [
      // Explicitly grant write/read access to your user groups
      allow.groups(["LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP"]).to(["read", "write", "delete"]),
    ],
  }),
});