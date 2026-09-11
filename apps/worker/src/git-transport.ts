import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ProviderConflictError,
  type ProviderFileChange,
  validateBranchName,
} from "@pushdocs/providers";

export interface PreparedCommit {
  branch: string;
  parentSha: string;
  sha: string;
}
export interface GitTransportOptions {
  directory: string;
  remote: string;
  authorization?: string;
  proxyUrl?: string;
  /** Only local integration fixtures may enable filesystem transport. Never read this from a repository. */
  allowLocal?: boolean;
}

/** Each operation owns its bare repository and index. No checkout, hooks or repository code run. */
export class GitTransport {
  private initialized = false;
  private readonly environment: NodeJS.ProcessEnv;
  constructor(private readonly options: GitTransportOptions) {
    if (
      !path.isAbsolute(options.directory) ||
      options.directory === path.parse(options.directory).root
    )
      throw new Error("A dedicated absolute Git operation directory is required");
    if (!options.allowLocal || !path.isAbsolute(options.remote)) {
      const remote = new URL(options.remote);
      if (!["http:", "https:"].includes(remote.protocol) || remote.username || remote.password)
        throw new Error("Git requires an HTTP(S) remote without embedded credentials");
    }
    this.environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    Object.assign(this.environment, {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "PushDocs",
      GIT_AUTHOR_EMAIL: "noreply@pushdocs.invalid",
      GIT_COMMITTER_NAME: "PushDocs",
      GIT_COMMITTER_EMAIL: "noreply@pushdocs.invalid",
    });
    const configuration = [
      ...(options.authorization ? [["http.extraHeader", options.authorization]] : []),
      ...(options.proxyUrl ? [["http.proxy", options.proxyUrl]] : []),
    ];
    Object.assign(this.environment, { GIT_CONFIG_COUNT: String(configuration.length) });
    configuration.forEach(([key, value], index) => {
      Object.assign(this.environment, {
        [`GIT_CONFIG_KEY_${index}`]: key,
        [`GIT_CONFIG_VALUE_${index}`]: value,
      });
    });
  }

  private run(args: string[], input?: Uint8Array | string, dates?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "credential.helper=",
          "-c",
          "http.followRedirects=false",
          "-c",
          "protocol.allow=never",
          "-c",
          "protocol.http.allow=always",
          "-c",
          "protocol.https.allow=always",
          "-c",
          `protocol.file.allow=${this.options.allowLocal ? "always" : "never"}`,
          "-C",
          this.options.directory,
          ...args,
        ],
        {
          env: {
            ...this.environment,
            ...(dates ? { GIT_AUTHOR_DATE: dates, GIT_COMMITTER_DATE: dates } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const output: Buffer[] = [];
      let size = 0;
      let error = "";
      const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 128 * 1024 * 1024) child.kill("SIGKILL");
        else output.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        error = (error + chunk.toString()).slice(-4000);
      });
      child.on("error", (cause) => {
        clearTimeout(timeout);
        reject(cause);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(Buffer.concat(output));
        else {
          let detail = error;
          const secrets = [
            this.options.authorization,
            this.options.authorization?.replace(/^Authorization: \S+ /, ""),
            this.options.proxyUrl,
          ].filter((value): value is string => Boolean(value));
          for (const secret of secrets) detail = detail.replaceAll(secret, "[redacted]");
          reject(new Error(`Git ${args[0]} failed (${code}): ${detail}`));
        }
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  }

  private async initialize() {
    if (this.initialized) return;
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    await this.run(["init", "--bare", "--quiet"]);
    this.initialized = true;
  }

  private sha(value: string) {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) throw new Error("Invalid Git object id");
    return value;
  }

  private filePath(value: string) {
    if (
      !value ||
      value.startsWith("/") ||
      value.includes("\\") ||
      [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      value
        .split("/")
        .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
    )
      throw new Error("Invalid Git file path");
    return value;
  }

  async head(branch: string): Promise<string> {
    validateBranchName(branch);
    await this.initialize();
    await this.run([
      "fetch",
      "--quiet",
      "--no-tags",
      this.options.remote,
      `+refs/heads/${branch}:refs/pushdocs/current`,
    ]);
    return (await this.run(["rev-parse", "refs/pushdocs/current"])).toString().trim();
  }

  async prepare(input: {
    branch: string;
    baseSha: string;
    operationId: string;
    createdAt: string;
    message: string;
    changes: ProviderFileChange[];
  }): Promise<PreparedCommit> {
    validateBranchName(input.branch);
    this.sha(input.baseSha);
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(input.operationId) ||
      !Number.isFinite(Date.parse(input.createdAt))
    )
      throw new Error("Invalid commit identity");
    if (new Set(input.changes.map((file) => file.path)).size !== input.changes.length)
      throw new Error("Duplicate Git file operations");
    for (const file of input.changes) this.filePath(file.path);
    await this.head(input.branch);
    await this.run(["read-tree", input.baseSha]);
    const records = (await this.run(["ls-tree", "-r", "-z", input.baseSha]))
      .toString()
      .split("\0")
      .filter(Boolean);
    const entries = new Map(
      records.map((record) => {
        const tab = record.indexOf("\t");
        return [record.slice(tab + 1), record.slice(0, tab).split(" ")];
      }),
    );
    for (const file of input.changes) {
      const existing = entries.get(file.path);
      if ((file.operation === "create" && existing) || (file.operation !== "create" && !existing))
        throw new ProviderConflictError(`File operation no longer matches base: ${file.path}`);
      if (existing && !["100644", "100755"].includes(existing[0] ?? ""))
        throw new Error("Cannot edit symlinks or submodules");
    }
    for (const file of input.changes.filter((item) => item.operation === "delete"))
      await this.run(
        ["update-index", "-z", "--index-info"],
        `0 ${"0".repeat(input.baseSha.length)}\t${file.path}\0`,
      );
    for (const file of input.changes.filter((item) => item.operation !== "delete")) {
      if (file.content === null) throw new Error("Missing Git file bytes");
      const sha = (await this.run(["hash-object", "-w", "--stdin"], file.content))
        .toString()
        .trim();
      await this.run([
        "update-index",
        "--add",
        "--cacheinfo",
        entries.get(file.path)?.[0] ?? "100644",
        sha,
        file.path,
      ]);
    }
    const tree = (await this.run(["write-tree"])).toString().trim();
    const originalTree = (await this.run(["rev-parse", `${input.baseSha}^{tree}`]))
      .toString()
      .trim();
    if (tree === originalTree)
      return { branch: input.branch, parentSha: input.baseSha, sha: input.baseSha };
    const sha = (
      await this.run(
        ["commit-tree", tree, "-p", input.baseSha],
        `${input.message.trim()}\n\nPushDocs-Operation: ${input.operationId}\n`,
        input.createdAt,
      )
    )
      .toString()
      .trim();
    return { branch: input.branch, parentSha: input.baseSha, sha };
  }

  async publish(prepared: PreparedCommit): Promise<{ sha: string; alreadyApplied: boolean }> {
    validateBranchName(prepared.branch);
    this.sha(prepared.parentSha);
    this.sha(prepared.sha);
    const current = await this.head(prepared.branch);
    if (current === prepared.sha) return { sha: prepared.sha, alreadyApplied: true };
    try {
      await this.run(["merge-base", "--is-ancestor", prepared.sha, current]);
      return { sha: prepared.sha, alreadyApplied: true };
    } catch {
      /* A different head must still pass the exact lease below. */
    }
    if (current !== prepared.parentSha)
      throw new ProviderConflictError("Ветка обновилась перед отправкой");
    try {
      await this.run([
        "push",
        "--porcelain",
        `--force-with-lease=refs/heads/${prepared.branch}:${prepared.parentSha}`,
        this.options.remote,
        `${prepared.sha}:refs/heads/${prepared.branch}`,
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /stale info|fetch first|non-fast-forward|failed to update ref/i.test(error.message)
      )
        throw new ProviderConflictError("Ветка обновилась во время отправки");
      throw error;
    }
    return { sha: prepared.sha, alreadyApplied: false };
  }
}
