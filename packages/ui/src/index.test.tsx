// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@base-ui/react/select", () => ({
  Select: {
    Icon: ({ children }: { children: ReactNode }) => children,
    Item: ({ children, value }: { children: ReactNode; value: string }) => (
      <div data-value={value} role="option" tabIndex={-1}>
        {children}
      </div>
    ),
    ItemIndicator: ({ children }: { children: ReactNode }) => children,
    ItemText: ({ children }: { children: ReactNode }) => children,
    Popup: ({ children }: { children: ReactNode }) => children,
    Portal: ({ children }: { children: ReactNode }) => children,
    Positioner: ({ children }: { children: ReactNode }) => children,
    Root: ({
      children,
      onValueChange,
    }: {
      children: ReactNode;
      onValueChange: (value: string | null) => void;
    }) => (
      <div>
        {children}
        <button onClick={() => onValueChange("stable")} type="button">
          Select stable
        </button>
        <button onClick={() => onValueChange(null)} type="button">
          Clear
        </button>
      </div>
    ),
    Trigger: ({ children, ...props }: { children: ReactNode; "aria-label"?: string }) => (
      <div aria-expanded="false" role="combobox" tabIndex={0} {...props}>
        {children}
      </div>
    ),
    Value: ({ children }: { children: ReactNode }) => children,
  },
}));

import { Button, Select, Status } from "./index";

afterEach(cleanup);

describe("Button", () => {
  it("combines the requested tone and caller class", () => {
    const onClick = vi.fn();
    render(
      <Button className="extra" onClick={onClick} tone="danger">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.className).toBe("pd-button pd-button--danger extra");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses the secondary tone by default and forwards attributes", () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toBe("pd-button pd-button--secondary");
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("Status", () => {
  it.each(["success", "warning", "danger", "neutral"] as const)("renders the %s state", (tone) => {
    render(<Status tone={tone}>State</Status>);
    expect(screen.getByText("State").className).toBe(`pd-status pd-status--${tone}`);
    cleanup();
  });
});

describe("Select", () => {
  it("shows the selected option and accessible label", () => {
    render(
      <Select
        label="Branch"
        options={[
          { label: "Main", value: "main" },
          { label: "Stable", value: "stable" },
        ]}
        value="stable"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Branch" }).textContent).toContain("Stable");
  });

  it("reports selected values and ignores a cleared value", () => {
    const onValueChange = vi.fn();
    render(
      <Select
        label="Branch"
        onValueChange={onValueChange}
        options={[
          { label: "Main", value: "main" },
          { label: "Stable", value: "stable" },
        ]}
        value="main"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select stable" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("stable");
  });
});
