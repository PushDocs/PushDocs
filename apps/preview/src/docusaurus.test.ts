import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { prepareDocusaurusPreview } from "./docusaurus";

it("serves static folders directly in preview without changing custom copies or production", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "preview-docusaurus-"));
  try {
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { start: "docusaurus start" } }),
    );
    const original = "export default {title: 'Site', plugins: ['original-plugin']};";
    await writeFile(path.join(cwd, "docusaurus.config.ts"), original);
    const command = ["yarn", "start", "--port", "{port}"];
    const prepared = await prepareDocusaurusPreview({ cwd, command });
    expect(prepared.slice(0, command.length)).toEqual(command);
    expect(prepared[command.length]).toBe("--config");
    const filename = prepared.at(-1);
    if (!filename) throw new Error("Expected generated config");
    expect(path.dirname(filename)).toBe(cwd);
    const source = await readFile(filename, "utf8");
    expect(source).toContain("docusaurus.config.ts");
    const factory = new Function(
      "original",
      "path",
      source.replace(/^import .*;\n/gm, "").replace("export default", "return"),
    );
    const base = {
      title: "Site",
      plugins: ["original-plugin"],
      staticDirectories: ["static", "staticLocalized/ru"],
    };
    const configured = await factory(async () => base, path)();
    expect((await factory(base, path)()).title).toBe("Site");
    expect(configured.title).toBe("Site");
    expect(configured.plugins[0]).toBe("original-plugin");
    const staticDirectories = ["static", "staticLocalized/ru"];
    const outDir = path.join(cwd, "build");
    class CopyPlugin {
      constructor(public patterns: unknown[]) {}
    }
    const patterns = staticDirectories.map((directory) => ({
      from: path.resolve(cwd, directory),
      to: outDir,
      toType: "dir",
      info: { minimized: true },
    }));
    const staticCopy = new CopyPlugin(patterns);
    const customCopy = new CopyPlugin([{ from: path.join(cwd, "extra"), to: outDir }]);
    const transformedCopy = new CopyPlugin([{ ...patterns[0], transform: () => "custom" }]);
    const mixedCopy = new CopyPlugin([...patterns, { from: "extra", to: outDir }]);
    const unrelated = { patterns };
    const plugin = configured.plugins[1]({
      siteDir: cwd,
      outDir,
      siteConfig: { staticDirectories },
    });
    const webpack = {
      cache: { type: "filesystem", buildDependencies: { config: ["original"] } },
      devtool: "eval-cheap-module-source-map",
      plugins: [staticCopy, customCopy, transformedCopy, mixedCopy, unrelated],
    };
    plugin.configureWebpack(webpack, false);
    expect(webpack.plugins).toEqual([customCopy, transformedCopy, mixedCopy, unrelated]);
    expect(configured.staticDirectories).toBe(base.staticDirectories);
    expect(webpack.cache).toEqual({ type: "memory", maxGenerations: 1 });
    expect(webpack.devtool).toBe(false);
    const production = { cache: false, devtool: "source-map", plugins: [staticCopy] };
    plugin.configureWebpack(production, true);
    expect(production).toEqual({ cache: false, devtool: "source-map", plugins: [staticCopy] });
    const productionClient = { ...production, mode: "production" };
    plugin.configureWebpack(productionClient, false);
    expect(productionClient.plugins).toEqual([staticCopy]);
    expect(productionClient.cache).toBe(false);
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
    expect(await prepareDocusaurusPreview({ cwd, command })).toEqual(command);
    const custom = ["docusaurus", "start", "--config", "custom.ts"];
    expect(await prepareDocusaurusPreview({ cwd, command: custom })).toEqual(custom);
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { start: "docusaurus start --config custom.ts" } }),
    );
    expect(await prepareDocusaurusPreview({ cwd, command })).toEqual(command);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
