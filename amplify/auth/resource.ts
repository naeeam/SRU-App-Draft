import { defineAuth } from "@aws-amplify/backend";

// One Cognito group per rank, highest to lowest.
// LTA and WO2 are Key Appointment Holders (KAH) and can approve leave.
// OIC is an admin role on top of a normal rank: regular personnel privileges, plus the Leave Balance page.
// DRIVER and the APPT_ groups are not ranks. A person is in their rank group, plus DRIVER if they
// are a driver, plus exactly one APPT_ group for their appointment (FF, SC, RC or DRC).
export const auth = defineAuth({
  loginWith: { email: true },
  groups: [
    "LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP",
    "OIC",
    "DRIVER",
    "APPT_FF", "APPT_SC", "APPT_RC", "APPT_DRC",
  ],
});