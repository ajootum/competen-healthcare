// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PageSearchInput } from "./PageSearch";

afterEach(cleanup);

describe("PageSearchInput Clear search", () => {
  it("blanks the field by default, as every other use", () => {
    const onChange = vi.fn();
    const { getByText } = render(<PageSearchInput scope="Searching" value="sepsis" onChange={onChange} placeholder="p" />);
    fireEvent.click(getByText("Clear search"));
    expect(onChange).toHaveBeenCalledWith("");
  });
  it("runs onClear instead when one is given, so a server-filtered list can be cleared too", () => {
    const onChange = vi.fn(), onClear = vi.fn();
    const { getByText } = render(<PageSearchInput scope="Searching" value="sepsis" onChange={onChange} onClear={onClear} placeholder="p" />);
    fireEvent.click(getByText("Clear search"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
