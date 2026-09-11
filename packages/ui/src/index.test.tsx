// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@base-ui/react/select", () => {
  let selectedValue: string | undefined;
  return {
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
        defaultValue,
        disabled,
        name,
        onValueChange,
        required,
        value,
      }: {
        children: ReactNode;
        defaultValue?: string;
        disabled?: boolean;
        name?: string;
        onValueChange: (value: string | null) => void;
        required?: boolean;
        value?: string;
      }) => {
        selectedValue = value ?? defaultValue;
        return (
          <div>
            {children}
            {name ? (
              <input
                aria-label={`${name} value`}
                disabled={disabled}
                name={name}
                required={required}
                value={value ?? defaultValue ?? ""}
                readOnly
              />
            ) : null}
            <button onClick={() => onValueChange("stable")} type="button">
              Select stable
            </button>
            <button onClick={() => onValueChange(null)} type="button">
              Clear
            </button>
          </div>
        );
      },
      Trigger: ({ children, ...props }: { children: ReactNode; "aria-label"?: string }) => (
        <button aria-expanded="false" role="combobox" type="button" {...props}>
          {children}
        </button>
      ),
      Value: ({
        children,
      }: {
        children: ReactNode | ((value: string | undefined) => ReactNode);
      }) => (typeof children === "function" ? children(selectedValue) : children),
    },
  };
});

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

  it("participates in native forms and forwards disabled state", () => {
    render(
      <Select
        defaultValue="stable"
        disabled
        label="Branch"
        name="branch"
        options={[{ label: "Stable", value: "stable" }]}
        required
      />,
    );
    const value = screen.getByLabelText("branch value") as HTMLInputElement;
    expect(value.name).toBe("branch");
    expect(value.value).toBe("stable");
    expect(value.required).toBe(true);
    expect(value.disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: "Branch" })).toHaveProperty("disabled", true);
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
