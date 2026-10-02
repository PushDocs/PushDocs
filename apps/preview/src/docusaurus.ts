import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./workspaces";

/** Preserve the real site, but don't serialize imported media into a second disk cache. */
export async function prepareDocusaurusPreview(options: {
  cwd: string;
  command: string[];
}): Promise<string[]> {
  const { cwd, command } = options;
  if (
    command.some(
      (argument) =>
        argument === "--config" || argument === "-c" || argument.startsWith("--config="),
    )
  )
    return command;
  let isDocusaurus = command[0] === "docusaurus" && command[1] === "start";
  if ((command[0] === "yarn" || command[0] === "pnpm") && command[1] === "start") {
    try {
      const packageJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
      const script = packageJson.scripts?.start ?? "";
      isDocusaurus =
        /^docusaurus\s+start(?:\s|$)/.test(script) &&
        !/(?:^|\s)(?:--config(?:=|\s)|-c(?:\s|$))|[;&|]/.test(script);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!isDocusaurus) return command;
  const configs: string[] = [];
  for (const extension of ["ts", "js", "mjs", "cjs"]) {
    const filename = path.join(cwd, `docusaurus.config.${extension}`);
    try {
      if ((await lstat(filename)).isFile()) configs.push(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Avoid choosing a different source configuration than the site's own CLI would.
  const [configPath] = configs;
  if (configs.length !== 1 || !configPath) return command;
  // Docusaurus resolves plugin paths from the config's directory, not process.cwd().
  // Use a new generated filename beside the source config, and remove it on shutdown.
  const filename = path.join(cwd, `.pushdocs-preview-${randomUUID()}.config.ts`);
  const relativeConfig = `./${path.basename(configPath)}`;
  await atomicWrite(
    filename,
    `import original from ${JSON.stringify(relativeConfig)};
export default async function (...args) {
  const config = await (typeof original === "function" ? original(...args) : original);
  return {
    ...config,
    plugins: [...(config.plugins ?? []), function pushdocsPreviewMemory() {
      return {
        name: "pushdocs-preview-memory",
        configureWebpack(webpack) {
          // Imported GIFs can total gigabytes. Filesystem cache serializes their buffers
          // again on disk and on every invalidation; reuse modules only in this process.
          webpack.cache = { type: "memory", maxGenerations: 1 };
          webpack.devtool = false;
          return {};
        },
      };
    }],
  };
}
`,
    0o600,
  );
  return [...command, "--config", filename];
}
