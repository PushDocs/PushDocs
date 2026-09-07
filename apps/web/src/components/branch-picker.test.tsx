// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/projects/project/documents",
  push: vi.fn(),
  searchParams: new URLSearchParams("path=docs%2Fa.md&locale=ru"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@pushdocs/ui", () => ({
  Select: ({
    label,
    onValueChange,
    options,
    value,
  }: {
    label: string;
    onValueChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

import { BranchPicker } from "./branch-picker";

afterEach(() => {
  cleanup();
  mocks.push.mockReset();
});

describe("BranchPicker", () => {
  it("keeps unrelated filters and clears the selected document", () => {
    render(
      <BranchPicker branches={[{ full_ref: "main" }, { full_ref: "release/2" }]} value="main" />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Ветка" }), {
      target: { value: "release/2" },
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/projects/project/documents?locale=ru&branch=release%2F2",
    );
  });
});
