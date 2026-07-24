import { redirect } from "next/navigation";

// POS-106A §19.1 backward compatibility. The Unit Manager Workspace must not host a duplicate
// operational data-entry module — operational entry moved to the Shift Supervisor Operations Centre
// (Operational Mode) and the UMW now presents Governance Mode. This legacy route redirects to the
// governance equivalent so existing bookmarks resolve without privilege escalation.
export default function OperationsCentreRedirect() {
  redirect("/unit-manager/patient-operations/governance");
}
