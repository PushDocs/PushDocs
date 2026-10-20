import { lstat, rm } from "node:fs/promises";
import path from "node:path";

async function removeCache(workspace: string, directory: string) {
  const relative = path.relative(workspace, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Кеш предпросмотра находится вне рабочей папки");
  let parent = workspace;
  // Never traverse a site-controlled symlink when removing a nested cache.
  for (const part of relative.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, part);
    try {
      const info = await lstat(parent);
      if (!info.isDirectory()) throw new Error(`Каталог кеша не является папкой: ${parent}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  await rm(directory, { recursive: true, force: true });
}

export async function clearPackageCache(workspace: string, cwd: string) {
  // Plug'n'Play loads packages directly from Yarn's cache, including in monorepos.
  let directory = cwd;
  while (true) {
    for (const filename of [".pnp.cjs", ".pnp.js"]) {
      try {
        await lstat(path.join(directory, filename));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (directory === workspace) break;
    const parent = path.dirname(directory);
    if (parent === directory || path.relative(workspace, parent).startsWith(".."))
      throw new Error("Сайт предпросмотра находится вне рабочей папки");
    directory = parent;
  }
  await removeCache(workspace, path.join(workspace, ".package-cache", "yarn"));
}

export async function clearWebpackCache(workspace: string, cwd: string) {
  await removeCache(workspace, path.join(cwd, ".cache", "pushdocs-webpack"));
}
