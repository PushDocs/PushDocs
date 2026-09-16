import { expect, it } from "vitest";
import { createPreviewService, retryGitFetch } from "./service";

const service = createPreviewService({ repository: {} as never });

it("expands only whole preview command placeholders", () => {
  expect(service.commandArgs(["yarn", "start", "--port", "{port}"], 43000)).toEqual([
    "yarn",
    ["start", "--port", "43000"],
  ]);
  expect(() => service.commandArgs(["yarn", "--port={port}"], 43000)).toThrow("отдельные");
});

it("retries an interrupted Git fetch but does not retry permanent failures", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await retryGitFetch(
    async () => {
      calls++;
      if (calls === 1)
        throw new Error(
          "git завершился с кодом 128: unexpected disconnect; early EOF; invalid index-pack output",
        );
      return "ok";
    },
    {
      delay: async () => {},
      onRetry: (_error, attempt) => {
        retries.push(attempt);
      },
    },
  );
  expect(result).toBe("ok");
  expect(calls).toBe(2);
  expect(retries).toEqual([1]);

  let permanentCalls = 0;
  await expect(
    retryGitFetch(
      async () => {
        permanentCalls++;
        throw new Error("authentication failed");
      },
      { delay: async () => {} },
    ),
  ).rejects.toThrow("authentication failed");
  expect(permanentCalls).toBe(1);
});
