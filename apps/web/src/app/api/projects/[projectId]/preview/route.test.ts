import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  inventory: vi.fn(),
  session: vi.fn(),
  current: vi.fn(),
  acquire: vi.fn(),
  attach: vi.fn(),
  release: vi.fn(),
  branch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    listPreviewInventory: mocks.inventory,
    getPreviewSession: mocks.session,
    isPreviewCurrent: mocks.current,
    acquirePreview: mocks.acquire,
    attachPreview: mocks.attach,
    releasePreview: mocks.release,
    getBranchState: mocks.branch,
  }),
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
const session = {
  id: "session",
  project_id: "project",
  branch: "main",
  status: "ready",
  desired_state: "running",
  user_stopped: false,
  log: "Site ready",
  last_error: null,
  port: 43000,
  head_sha: "old",
  revision: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ role: "reader" });
  mocks.inventory.mockResolvedValue([]);
  mocks.session.mockResolvedValue(session);
  mocks.acquire.mockResolvedValue(session);
  mocks.attach.mockResolvedValue(session);
  mocks.current.mockResolvedValue(true);
});
it("attaches document visits to existing previews without acquiring a new one and releases with one hour grace", async () => {
  const request = (action: string) =>
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({
        action,
        branch: "main",
        clientId: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000002",
      }),
    });
  await POST(request("attach"), context);
  expect(mocks.attach).toHaveBeenCalled();
  expect(mocks.acquire).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ ...session, id: "00000000-0000-4000-8000-000000000002" });
  await POST(request("release"), context);
  expect(mocks.release).toHaveBeenCalledWith(
    "00000000-0000-4000-8000-000000000002",
    "user",
    "00000000-0000-4000-8000-000000000001",
    3_600_000,
  );
});
it("withholds an outdated preview URL until the saved revision and imported commit are applied", async () => {
  mocks.current.mockResolvedValue(false);
  const response = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(await response.json()).toMatchObject({
    status: "starting",
    message: "Обновляем файлы предпросмотра…",
  });
  const fresh = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect((await fresh.json()).url).toBeUndefined();
  mocks.current.mockResolvedValue(true);
  const ready = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(await ready.json()).toMatchObject({
    status: "ready",
    url: expect.stringContaining(":43000/"),
  });
});
it("rechecks content after acquisition rather than advertising an existing outdated session as ready", async () => {
  mocks.current.mockResolvedValue(false);
  const response = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({
        action: "acquire",
        branch: "main",
        clientId: "00000000-0000-4000-8000-000000000001",
      }),
    }),
    context,
  );
  expect(await response.json()).toMatchObject({ status: "starting" });
  expect(mocks.current).toHaveBeenCalledWith(session);
});
it("reports intentional stopping and deletion without offering a URL", async () => {
  mocks.session.mockResolvedValue({ ...session, desired_state: "stopped", user_stopped: true });
  const stopped = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(await stopped.json()).toMatchObject({ status: "stopped", manuallyStopped: true });
  mocks.inventory.mockResolvedValue([{ branch: "main", delete_requested: true, deleted: false }]);
  const deleting = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(await deleting.json()).toEqual({ status: "deleting", manuallyStopped: true });
});
