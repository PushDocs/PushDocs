import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./workspaces";

/** Keep the real site while serving static files directly and limiting compiler cache. */
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
    `import path from "node:path";
import original from ${JSON.stringify(relativeConfig)};
export default async function (...args) {
  const config = await (typeof original === "function" ? original(...args) : original);
  return {
    ...config,
    plugins: [...(config.plugins ?? []), function pushdocsPreviewMemory(context) {
      return {
        name: "pushdocs-preview-memory",
        configureWebpack(webpack, isServer) {
          if (isServer || webpack.mode === "production") return {};
          // Docusaurus already serves these folders through devServer.static.
          // Only remove its exact static-copy plugin, not arbitrary site copy jobs.
          const staticDirs = (context.siteConfig.staticDirectories ?? ["static"])
            .map(directory => path.resolve(context.siteDir, directory));
          webpack.plugins = (webpack.plugins ?? []).filter(plugin => !(
            plugin?.constructor?.name === "CopyPlugin" &&
            Array.isArray(plugin.patterns) && plugin.patterns.length > 0 &&
            plugin.patterns.every(pattern =>
              staticDirs.includes(pattern.from) && pattern.to === context.outDir &&
              pattern.toType === "dir" && pattern.info?.minimized === true &&
              Object.keys(pattern).every(key => ["from", "to", "toType", "info"].includes(key)) &&
              Object.keys(pattern.info).length === 1
            )
          ));
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
