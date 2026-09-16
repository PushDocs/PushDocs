import { expect, it } from "vitest";
import { createPreviewService } from "./service";

const service = createPreviewService({ repository: {} as never });

it("expands only whole preview command placeholders", () => {
  expect(service.commandArgs(["yarn", "start", "--port", "{port}"], 43000)).toEqual([
    "yarn",
    ["start", "--port", "43000"],
  ]);
  expect(() => service.commandArgs(["yarn", "--port={port}"], 43000)).toThrow("отдельные");
});
