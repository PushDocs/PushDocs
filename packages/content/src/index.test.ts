import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocusaurusProject } from "./index";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { force: true, recursive: true });
});

describe("Docusaurus discovery", () => {
  it("reads MDX without executing project code", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-content-"));
    await mkdir(path.join(directory, "docs"));
    await writeFile(
      path.join(directory, "docs", "intro.mdx"),
      "---\ntitle: Начало работы\n---\n\n<SupportLink />\n",
    );
    const profile = await discoverDocusaurusProject(directory);
    expect(profile.documents[0]?.title).toBe("Начало работы");
    expect(profile.unknownComponents).toEqual(["SupportLink"]);
  });
});
