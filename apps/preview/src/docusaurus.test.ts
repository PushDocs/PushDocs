import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { prepareDocusaurusPreview } from "./docusaurus";

it("keeps the site's config and plugins but replaces the media-heavy disk cache", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "preview-docusaurus-"));
  try {
    const home = path.join(cwd, ".home");
    await mkdir(home);
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { start: "docusaurus start" } }),
    );
    const original = "export default {title: 'Site', plugins: ['original-plugin']};";
    await writeFile(path.join(cwd, "docusaurus.config.ts"), original);
    const command = ["yarn", "start", "--port", "{port}"];
    const prepared = await prepareDocusaurusPreview({ cwd, home, command });
    expect(prepared.slice(0, command.length)).toEqual(command);
    expect(prepared[command.length]).toBe("--config");
    const filename = prepared.at(-1);
    if (!filename) throw new Error("Expected generated config");
    const source = await readFile(filename, "utf8");
    expect(source).toContain("docusaurus.config.ts");
    const factory = new Function(
      "original",
      source.replace(/^import .*;\n/, "").replace("export default", "return"),
    );
    const base = { title: "Site", plugins: ["original-plugin"] };
    const configured = await factory(async () => base)();
    expect((await factory(base)()).title).toBe("Site");
    expect(configured.title).toBe("Site");
    expect(configured.plugins[0]).toBe("original-plugin");
    const plugin = configured.plugins[1]();
    const webpack = {
      cache: { type: "filesystem", buildDependencies: { config: ["original"] } },
      devtool: "eval-cheap-module-source-map",
    };
    plugin.configureWebpack(webpack);
    expect(webpack.cache).toEqual({ type: "memory", maxGenerations: 1 });
    expect(webpack.devtool).toBe(false);
    expect(await readFile(path.join(cwd, "docusaurus.config.ts"), "utf8")).toBe(original);
    expect(command).toEqual(["yarn", "start", "--port", "{port}"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it("does not alter another framework or a manually configured Docusaurus command", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "preview-other-framework-"));
  try {
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ scripts: { start: "vite" } }));
    await writeFile(path.join(cwd, "docusaurus.config.ts"), "export default {};");
    const command = ["yarn", "start"];
    expect(await prepareDocusaurusPreview({ cwd, home: path.join(cwd, ".home"), command })).toEqual(
      command,
    );
    const custom = ["docusaurus", "start", "--config", "custom.ts"];
    expect(
      await prepareDocusaurusPreview({ cwd, home: path.join(cwd, ".home"), command: custom }),
    ).toEqual(custom);
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { start: "docusaurus start --config custom.ts" } }),
    );
    expect(await prepareDocusaurusPreview({ cwd, home: path.join(cwd, ".home"), command })).toEqual(
      command,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
