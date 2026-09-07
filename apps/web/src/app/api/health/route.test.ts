import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkDatabase: vi.fn() }));

vi.mock("@pushdocs/db", () => ({ checkDatabase: mocks.checkDatabase }));

import { GET } from "./route";

beforeEach(() => {
  mocks.checkDatabase.mockResolvedValue(undefined);
});

describe("health endpoint", () => {
  it("reports a ready database", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ database: "ready", status: "ok" });
  });

  it("reports a database readiness failure", async () => {
    mocks.checkDatabase.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ database: "unavailable", status: "error" });
  });
});
