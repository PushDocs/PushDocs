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
      siteConfigPath: filename,
      siteConfig: { staticDirectories },
    });
    const webpack = {
      cache: {
        type: "filesystem",
        name: "client-development-ru",
        version: "docusaurus-aliases",
        buildDependencies: { config: ["webpack-base.js", filename], extra: ["extra-config.js"] },
      },
      devtool: "eval-cheap-module-source-map",
      plugins: [staticCopy, customCopy, transformedCopy, mixedCopy, unrelated],
    };
    plugin.configureWebpack(webpack, false);
    expect(webpack.plugins).toEqual([customCopy, transformedCopy, mixedCopy, unrelated]);
    expect(configured.staticDirectories).toBe(base.staticDirectories);
    expect(webpack.cache).toMatchObject({
      type: "filesystem",
      maxMemoryGenerations: 1,
      cacheDirectory: path.join(cwd, ".cache", "pushdocs-webpack"),
      name: "client-development-ru-pushdocs-preview",
      buildDependencies: {
        config: ["webpack-base.js", path.join(cwd, "docusaurus.config.ts")],
        extra: ["extra-config.js"],
      },
    });
    expect(webpack.cache.version).toContain("docusaurus-aliases");
    expect(webpack.cache.version).not.toContain(filename);
    expect(webpack.cache).toMatchObject({
      idleTimeout: 1000,
      idleTimeoutForInitialStore: 1000,
      idleTimeoutAfterLargeChanges: 1000,
    });
    const next = await prepareDocusaurusPreview({ cwd, command });
    const nextFilename = next.at(-1);
    if (!nextFilename) throw new Error("Expected second generated config");
    expect(nextFilename).not.toBe(filename);
    const nextFactory = new Function(
      "original",
      "path",
      (await readFile(nextFilename, "utf8"))
        .replace(/^import .*;\n/gm, "")
        .replace("export default", "return"),
    );
    const nextConfig = await nextFactory(base, path)();
    const nextWebpack = {
      cache: {
        type: "filesystem",
        name: "client-development-ru",
        version: "docusaurus-aliases",
        buildDependencies: {
          config: ["webpack-base.js", nextFilename],
          extra: ["extra-config.js"],
        },
      },
    };
    nextConfig.plugins[1]({
      siteDir: cwd,
      siteConfigPath: nextFilename,
      siteConfig: base,
    }).configureWebpack(nextWebpack, false);
    expect(nextWebpack.cache).toEqual(webpack.cache);
    expect(webpack.devtool).toBe(false);
    const production = { cache: false, devtool: "source-map", plugins: [staticCopy] };
    plugin.configureWebpack(production, true);
    expect(production).toEqual({ cache: false, devtool: "source-map", plugins: [staticCopy] });
    const productionClient = { ...production, mode: "production" };
    plugin.configureWebpack(productionClient, false);
    expect(productionClient.plugins).toEqual([staticCopy]);
    expect(productionClient.cache).toBe(false);
    const disabled = { cache: false };
    plugin.configureWebpack(disabled, false);
    expect(disabled.cache).toBe(false);
    const memory = { cache: { type: "memory" } };
    plugin.configureWebpack(memory, false);
    expect(memory.cache).toEqual({ type: "memory", maxGenerations: 1 });
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
