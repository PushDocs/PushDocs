// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthPanel } from "./auth-panel";
import { PushDocsLogo } from "./pushdocs-logo";

afterEach(cleanup);

describe("PushDocsLogo", () => {
  it.each([
    [false, "22"],
    [true, "18"],
  ] as const)("renders the compact=%s mark", (compact, size) => {
    render(<PushDocsLogo compact={compact} />);
    const logo = screen.getByRole("img", { name: "PushDocs" });
    expect(logo.textContent).toBe("PushDocs");
    expect(logo.querySelector("svg")?.getAttribute("width")).toBe(size);
    cleanup();
  });
});

describe("AuthPanel", () => {
  it("renders the product context and supplied form", () => {
    render(
      <AuthPanel description="Use your account" eyebrow="Welcome" title="Sign in">
        <button type="button">Continue</button>
      </AuthPanel>,
    );
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Use your account")).toBeTruthy();
    expect(screen.getByText("GitHub и GitLab, включая свои серверы")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
});
