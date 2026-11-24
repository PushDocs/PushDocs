import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { privateTreeOperation } from "./private-filesystem";

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pushdocs-private-tree-"));
  temporary.push(root);
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  await mkdir(source);
  await mkdir(destination, { mode: 0o700 });
  return { root, source, destination };
}

it("copies ordinary cache bytes into distinct inodes and preserves executable mode", async () => {
  const { source, destination } = await fixture();
  await mkdir(path.join(source, "node_modules"));
  const before = path.join(source, "node_modules/tool");
  const after = path.join(destination, "node_modules/tool");
  await writeFile(before, "cache", { mode: 0o755 });
  expect((await privateTreeOperation("copy-caches", source, destination)).complete).toBe(true);
  expect(await readFile(after, "utf8")).toBe("cache");
  expect((await stat(after)).ino).not.toBe((await stat(before)).ino);
  expect((await stat(after)).mode & 0o777).toBe(0o755);
  await writeFile(before, "late old writer");
  expect(await readFile(after, "utf8")).toBe("cache");
});

it("invalidates hardlinked cache files and does not descend through symlink directories", async () => {
  const { root, source, destination } = await fixture();
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "private"), "outside data");
  await mkdir(path.join(source, "node_modules"));
  await link(path.join(outside, "private"), path.join(source, "node_modules/hardlink"));
  await symlink(outside, path.join(source, "node_modules/linked"));
  expect((await privateTreeOperation("copy-caches", source, destination)).complete).toBe(false);
  await expect(lstat(path.join(destination, "node_modules/hardlink"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await lstat(path.join(destination, "node_modules/linked"))).isSymbolicLink()).toBe(true);
  expect(await readFile(path.join(outside, "private"), "utf8")).toBe("outside data");
});

it("preserves unchanged article times but ignores a hardlinked source inode", async () => {
  const { root, source, destination } = await fixture();
  const outside = path.join(root, "outside");
  await writeFile(outside, "same");
  await link(outside, path.join(source, "hardlinked.md"));
  await writeFile(path.join(source, "ordinary.md"), "same");
  await writeFile(path.join(destination, "hardlinked.md"), "same");
  await writeFile(path.join(destination, "ordinary.md"), "same");
  const old = new Date("2000-01-01T00:00:00Z");
  await utimes(outside, old, old);
  await utimes(path.join(source, "ordinary.md"), old, old);
  await privateTreeOperation("preserve-times", source, destination);
  expect((await stat(path.join(destination, "ordinary.md"))).mtimeMs).toBe(old.getTime());
  expect((await stat(path.join(destination, "hardlinked.md"))).mtimeMs).not.toBe(old.getTime());
  expect((await stat(outside)).mtimeMs).toBe(old.getTime());
});

it("preserves an untracked Yarn PnP cache and unplugged packages", async () => {
  const { source, destination } = await fixture();
  await mkdir(path.join(source, ".yarn/cache"), { recursive: true });
  await mkdir(path.join(source, ".yarn/unplugged/pkg"), { recursive: true });
  await writeFile(path.join(source, ".pnp.cjs"), "pnp loader");
  await writeFile(path.join(source, ".pnp.data.json"), "pnp data");
  await writeFile(path.join(source, ".yarn/cache/pkg.zip"), "archive");
  await writeFile(path.join(source, ".yarn/unplugged/pkg/tool"), "native package");
  await writeFile(path.join(source, ".yarn/install-state.gz"), "install state");
  expect((await privateTreeOperation("copy-caches", source, destination)).complete).toBe(true);
  expect(await readFile(path.join(destination, ".yarn/cache/pkg.zip"), "utf8")).toBe("archive");
  expect(await readFile(path.join(destination, ".yarn/unplugged/pkg/tool"), "utf8")).toBe(
    "native package",
  );
  expect(await readFile(path.join(destination, ".pnp.data.json"), "utf8")).toBe("pnp data");
});
