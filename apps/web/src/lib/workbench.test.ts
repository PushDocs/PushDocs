import { parseProjectConfig } from "@pushdocs/content";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireProjectAccess: vi.fn(),
  getProjectSyncTarget: vi.fn(),
  listWorkingFiles: vi.fn(),
  createProvider: vi.fn(),
  providerForConnection: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ requireUser: mocks.requireUser, repository: () => mocks }));
vi.mock("@pushdocs/providers", () => ({ createProvider: mocks.createProvider }));
vi.mock("@pushdocs/db", () => ({ decryptSecret: () => "token" }));
vi.mock("./provider", () => ({ providerForConnection: mocks.providerForConnection }));

import { apiError, assertEditable, assertSameOrigin, workbenchContext } from "./workbench";

beforeEach(() => {
  mocks.providerForConnection.mockImplementation(async () => mocks.createProvider());
  mocks.requireUser.mockResolvedValue({ id: "user" });
  mocks.requireProjectAccess.mockResolvedValue({ role: "editor" });
  mocks.getProjectSyncTarget.mockResolvedValue({
    kind: "gitlab",
    base_url: "https://gitlab.test",
    secret_encrypted: "encrypted",
  });
  mocks.listWorkingFiles.mockResolvedValue({ files: [] });
});
it("checks membership before accessing branch content", async () => {
  expect((await workbenchContext("project", "docs/new")).config.version).toBe(1);
  expect(mocks.requireProjectAccess).toHaveBeenCalledWith("user", "project");
  expect(mocks.listWorkingFiles).toHaveBeenCalledWith("project", "docs/new");
});
it("uses the branch draft config and rejects revoked connections", async () => {
  mocks.listWorkingFiles.mockResolvedValue({
    files: [
      {
        path: ".pushdocs/config.json",
        content: '{"version":1,"defaultLocale":"fr"}',
        status: "modify",
      },
    ],
  });
  expect((await workbenchContext("project", "main")).config.defaultLocale).toBe("fr");
  mocks.getProjectSyncTarget.mockResolvedValue(undefined);
  await expect(workbenchContext("project", "main")).rejects.toThrow("Подключение");
});
it("enforces file policy and administrator-only config writes, including reverts", () => {
  const config = parseProjectConfig();
  expect(() => assertEditable(config, "docs/a.md", "editor")).not.toThrow();
  expect(() => assertEditable(config, ".pushdocs/config.json", "admin")).not.toThrow();
  expect(() => assertEditable(config, ".pushdocs/config.json", "editor")).toThrow("администратор");
  expect(() => assertEditable(config, "server.js", "admin")).toThrow("не разрешён");
  expect(() => assertEditable(config, "../secret", "admin")).toThrow();
});
it("rejects cross-origin mutations and gives typed error statuses", async () => {
  expect(() =>
    assertSameOrigin(
      new Request("https://cms.test/api", { headers: { Origin: "https://cms.test" } }),
    ),
  ).not.toThrow();
  for (const origin of ["", "https://evil.test"])
    expect(() =>
      assertSameOrigin(new Request("https://cms.test/api", { headers: { Origin: origin } })),
    ).toThrow();
  expect(apiError({ code: "REVISION_CONFLICT" }).status).toBe(409);
  expect(apiError({ code: "ACCESS_DENIED" }).status).toBe(403);
  expect(apiError(new Error("NEXT_REDIRECT")).status).toBe(401);
  expect(apiError(null).status).toBe(400);
  expect(await apiError(new Error("Failed")).json()).toEqual({ error: "Failed" });
});
