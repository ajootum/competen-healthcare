"use client";

import { createContext, useContext } from "react";

// PLP-01..04. Whether My Plan is on for this learner (HQ policy AND migration 780), decided once by the experience layout and
// read by the tab bar, so the nineteen pages that render StudyNav need no new argument. The default is OFF: with no provider the
// My Plan tab is simply not drawn, so the feature fails closed.
const MyPlanOn = createContext(false);
export function MyPlanNavProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <MyPlanOn.Provider value={on}>{children}</MyPlanOn.Provider>;
}
export const useMyPlanOn = () => useContext(MyPlanOn);
