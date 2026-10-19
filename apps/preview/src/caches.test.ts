import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { clearPackageCache, clearWebpackCache } from "./caches";

it.each([".pnp.cjs", ".pnp.js"])(
  "preserves packages used by %s when the site runs in a nested directory",
  async (loader) => {
    const workspace = await mkdtemp(path.join(tmpdir(), "pushdocs-pnp-cache-"));
    try {
      const cwd = path.join(workspace, "apps/docs");
      const cache = path.join(workspace, ".package-cache/yarn");
      await mkdir(cwd, { recursive: true });
      await mkdir(cache, { recursive: true });
      await writeFile(path.join(cache, "package.zip"), "runtime dependency");
      await writeFile(path.join(workspace, loader), "package loader");
      await clearPackageCache(workspace, cwd);
      expect(await readFile(path.join(cache, "package.zip"), "utf8")).toBe("runtime dependency");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

it("clears the runner's cache in the site directory without removing other caches", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "pushdocs-nested-cache-"));
  try {
    const cwd = path.join(workspace, "apps/docs");
    const cache = path.join(cwd, ".cache/pushdocs-webpack");
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, "cache.pack"), "compiled modules");
    await writeFile(path.join(cwd, ".cache/other"), "keep");
    await clearWebpackCache(workspace, cwd);
    await expect(stat(cache)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(cwd, ".cache/other"), "utf8")).toBe("keep");
    await clearWebpackCache(workspace, cwd);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

it.each([".cache", ".package-cache"])(
  "does not follow a %s symlink outside the workspace",
  async (parent) => {
    const root = await mkdtemp(path.join(tmpdir(), "pushdocs-cache-symlink-"));
    try {
      const workspace = path.join(root, "workspace");
      const outside = path.join(root, "outside");
      const name = parent === ".cache" ? "pushdocs-webpack" : "yarn";
      await mkdir(workspace);
      await mkdir(path.join(outside, name), { recursive: true });
      await writeFile(path.join(outside, name, "keep"), "external file");
      await symlink(outside, path.join(workspace, parent));
      const clear = parent === ".cache" ? clearWebpackCache : clearPackageCache;
      await expect(clear(workspace, workspace)).rejects.toThrow("не является папкой");
      expect(await readFile(path.join(outside, name, "keep"), "utf8")).toBe("external file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
