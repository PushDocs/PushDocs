import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  findUserBySessionHash: vi.fn(),
  hashOpaqueToken: vi.fn((token: string) => `hash:${token}`),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@pushdocs/db", () => ({
  getDatabase: vi.fn(() => ({ kind: "database" })),
  hashOpaqueToken: mocks.hashOpaqueToken,
  PushDocsRepository: vi.fn(function PushDocsRepository() {
    return {
      findUserBySessionHash: mocks.findUserBySessionHash,
      listProjects: vi.fn().mockResolvedValue([]),
    };
  }),
}));

import {
  actor,
  application,
  optionalUser,
  repository,
  requireOperator,
  requireUser,
  sessionCookieName,
} from "./server";

beforeEach(() => {
  mocks.cookieGet.mockReset();
  mocks.findUserBySessionHash.mockReset();
  mocks.hashOpaqueToken.mockClear();
  mocks.redirect.mockClear();
});

describe("server dependencies", () => {
  it("uses the stable session cookie name", () => {
    expect(sessionCookieName).toBe("pushdocs_session");
  });

  it("creates repository and application ports", async () => {
    expect(repository()).toMatchObject({
      findUserBySessionHash: expect.any(Function),
      listProjects: expect.any(Function),
    });
    await expect(
      application().listProjects({ id: "user", isInstanceOperator: false }),
    ).resolves.toEqual([]);
  });
});

describe("current user", () => {
  it("returns null without a browser session", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(optionalUser()).resolves.toBeNull();
    expect(mocks.findUserBySessionHash).not.toHaveBeenCalled();
  });

  it("returns null when the session no longer resolves", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    mocks.findUserBySessionHash.mockResolvedValue(undefined);
    await expect(optionalUser()).resolves.toBeNull();
    expect(mocks.hashOpaqueToken).toHaveBeenCalledWith("token");
  });

  it("maps a stored user to the public session shape", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    mocks.findUserBySessionHash.mockResolvedValue({
      display_name: "Anna",
      email: "anna@example.test",
      id: "user",
      is_instance_operator: true,
    });
    await expect(optionalUser()).resolves.toEqual({
      displayName: "Anna",
      email: "anna@example.test",
      id: "user",
      isInstanceOperator: true,
    });
  });

  it("requires a signed in user", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("returns the signed in user", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    mocks.findUserBySessionHash.mockResolvedValue({
      display_name: "Reader",
      email: "reader@example.test",
      id: "reader",
      is_instance_operator: false,
    });
    await expect(requireUser()).resolves.toMatchObject({ id: "reader" });
  });

  it("requires the installation operator", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    mocks.findUserBySessionHash.mockResolvedValue({
      display_name: "Reader",
      email: "reader@example.test",
      id: "reader",
      is_instance_operator: false,
    });
    await expect(requireOperator()).rejects.toThrow("REDIRECT:/projects");
  });

  it("returns the installation operator", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    mocks.findUserBySessionHash.mockResolvedValue({
      display_name: "Operator",
      email: "operator@example.test",
      id: "operator",
      is_instance_operator: true,
    });
    await expect(requireOperator()).resolves.toMatchObject({
      id: "operator",
      isInstanceOperator: true,
    });
  });

  it("converts a current user to a domain actor", () => {
    expect(
      actor({
        displayName: "Editor",
        email: "editor@example.test",
        id: "editor",
        isInstanceOperator: false,
      }),
    ).toEqual({ id: "editor", isInstanceOperator: false });
  });
});
