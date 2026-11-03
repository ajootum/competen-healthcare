// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { RESP_ASSESS, RESP_RULES, uid } from "@/lib/assessment/core/fixtures";
import { STANDARD_CHECKLIST_LAYOUT } from "@/lib/assessment/core";
import { AssessorRunnerClient } from "./AssessorRunnerClient";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the assessor runner's per-item Evidence label", () => {
  it("counts a note as soon as it is added", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "ev-1" }), { status: 200 })));
    const { container } = render(
      <AssessorRunnerClient instanceId="i1" def={RESP_ASSESS} rules={RESP_RULES} standardLayout={STANDARD_CHECKLIST_LAYOUT} guidedLayout={null}
        initialResponses={{}} initialRevisions={{}} initialEvidence={[]} initialComments={[]} title="t" subtitle="s" subjectName="P" assessorName="A" authority={null} methodLabels={{}} />,
    );
    const a = container.querySelector<HTMLElement>(`article[data-item-key="${uid(15)}"]`)!;
    const drawer = within(a).getByRole("button", { name: "Evidence (0)" });
    fireEvent.click(drawer);
    fireEvent.change(within(a).getByLabelText("Evidence note"), { target: { value: "Seen at the bedside" } });
    fireEvent.click(within(a).getByRole("button", { name: "Add evidence" }));
    await waitFor(() => expect(within(a).getByRole("button", { name: "Evidence (1)" })).toBeTruthy());
  });
});
