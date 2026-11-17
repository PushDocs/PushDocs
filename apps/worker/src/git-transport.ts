import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseProjectConfig } from "@pushdocs/content";
import { mediaUsages } from "@pushdocs/content/media";
import { readMetadata } from "@pushdocs/content/metadata";
import {
  BranchConflictChoice,
  type BranchConflictResolution,
  type BranchConflictSection,
  type BranchConflictSnapshot,
  BranchUpdateStrategy,
  branchConflictCache,
  branchConflictLimits,
  branchUpdateLimits,
  ConflictInspectionStage,
  conflictReportLimits,
  type GitTransferProgress,
  isConflictMediaFile,
  type PreparedBranchUpdate,
  projectConfigPaths,
  type RebaseProgress,
} from "@pushdocs/contracts";
import {
  ProviderConflictError,
  type ProviderFileChange,
  validateBranchName,
} from "@pushdocs/providers";
import { conflictMarkerSize, parseConflictSections } from "./conflict-sections";

class GitCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly output = Buffer.alloc(0),
  ) {
    super(message);
  }
}

export class BranchMergeConflictError extends Error {}

export class RebaseNeedsResolution extends Error {
  constructor(
    readonly progress: RebaseProgress,
    readonly snapshot: BranchConflictSnapshot,
  ) {
    super(
      `Rebase остановлен на коммите ${snapshot.rebase?.commitSha.slice(0, 8)}: ${snapshot.files.map((file) => file.path).join(", ")}. Ветка в Git не изменена.`,
    );
  }
}

export interface PreparedCommit {
  branch: string;
  parentSha: string;
  sha: string;
}
export interface PreparedBranchMerge extends PreparedCommit {
  sourceSha: string;
}

type MergeEntry = { mode: string; sha: string };
type MergeStages = { base?: MergeEntry; ours?: MergeEntry; theirs?: MergeEntry };
const regularFileModes = new Set(["100644", "100755"]);
const isOpaqueMediaFile = isConflictMediaFile;
const conflictVerificationMessage =
  "Полная проверка Git обнаружила другой конфликт или переименование. Разрешите его в Git-провайдере.";
const supportedConflictTypes = new Set([
  "Auto-merging",
  "CONFLICT (contents)",
  "CONFLICT (modify/delete)",
  "CONFLICT (binary)",
]);

export interface GitTransportOptions {
  directory: string;
  remote: string;
  authorization?: string;
  proxyUrl?: string;
  /** Only local integration fixtures may enable filesystem transport. Never read this from a repository. */
  allowLocal?: boolean;
  onProgress?: (progress: GitTransportProgress) => void;
}

export interface GitTransportProgress {
  stage: ConflictInspectionStage;
  transfer: GitTransferProgress;
  counts?: { completed: number; total: number };
}

/** Each operation owns its bare repository and index. No checkout, hooks or repository code run. */
export class GitTransport {
  private initialized = false;
  private receivedBytes = 0;
  private stage = ConflictInspectionStage.Fetching;
  private counts?: { completed: number; total: number };
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

  private run(
    args: string[],
    input?: Uint8Array | string,
    dates?: string,
    author?: { name: string; email: string; date: string },
    checkFilterCapability = false,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isolated = process.platform !== "win32";
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
            ...(this.options.onProgress ? { GIT_TRACE_PACKFILE: "3" } : {}),
            ...(checkFilterCapability ? { GIT_TRACE_PACKET: "1" } : {}),
            ...(dates ? { GIT_AUTHOR_DATE: dates, GIT_COMMITTER_DATE: dates } : {}),
            ...(author
              ? {
                  GIT_AUTHOR_NAME: author.name,
                  GIT_AUTHOR_EMAIL: author.email,
                  GIT_AUTHOR_DATE: author.date,
                }
              : {}),
          },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
          detached: isolated,
        },
      );
      const terminate = () => {
        try {
          if (isolated && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const output: Buffer[] = [];
      // Pack bytes go to a dedicated pipe. Only their length leaves this process.
      child.stdio[3]?.on("data", (chunk: Buffer) => {
        this.receivedBytes += chunk.byteLength;
        this.reportProgress();
      });
      let size = 0;
      let error = "";
      let filterAvailable = false;
      const timeout = setTimeout(terminate, 120_000);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        /* v8 ignore next -- exercising the 128 MiB process cap would make the unit suite unsafe. */
        if (size > 128 * 1024 * 1024) terminate();
        else output.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (
          checkFilterCapability &&
          /packet:\s+\S+[<>] fetch=[^\r\n]*\bfilter\b/.test(error + chunk.toString())
        )
          filterAvailable = true;
        error = (error + chunk.toString()).slice(-4000);
      });
      child.on("error", (cause) => {
        clearTimeout(timeout);
        reject(cause);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0)
          resolve(
            checkFilterCapability
              ? Buffer.from(filterAvailable ? "filter" : "")
              : Buffer.concat(output),
          );
        else {
          let detail = error;
          const secrets = [
            this.options.authorization,
            this.options.authorization?.replace(/^Authorization: \S+ /, ""),
            this.options.proxyUrl,
          ].filter((value): value is string => Boolean(value));
          for (const secret of secrets) detail = detail.replaceAll(secret, "[redacted]");
          reject(
            new GitCommandError(
              `Git ${args[0]} failed (${code}): ${detail}`,
              code,
              Buffer.concat(output),
            ),
          );
        }
      });
      /* v8 ignore next -- broken-pipe notification is deliberately consumed by Node. */
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  }

  private reportProgress(
    stage?: ConflictInspectionStage,
    counts?: { completed: number; total: number },
  ) {
    if (stage) {
      this.stage = stage;
      this.counts = counts;
    }
    this.options.onProgress?.({
      stage: this.stage,
      counts: this.counts,
      transfer: { receivedBytes: this.receivedBytes, totalBytes: null },
    });
  }

  private async initialize() {
    if (this.initialized) return;
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    await this.run(["init", "--bare", "--quiet"]);
    await this.run(["config", "remote.origin.url", this.options.remote]);
    await this.run(["config", "remote.origin.promisor", "true"]);
    await this.run(["config", "remote.origin.partialclonefilter", "blob:none"]);
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
      "--filter=blob:none",
      "origin",
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
    const tree = (await this.run(["write-tree", "--missing-ok"])).toString().trim();
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

  private async mergeTree(parentSha: string, sourceSha: string, baseTree?: string) {
    let output: Buffer;
    try {
      output = await this.run([
        "merge-tree",
        "--write-tree",
        "-z",
        ...(baseTree ? [`--merge-base=${baseTree}`] : []),
        parentSha,
        sourceSha,
      ]);
    } catch (error) {
      if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
      output = error.output;
    }
    const records = this.decodeGitPaths(output).split("\0");
    const tree = this.sha(records.shift() ?? "");
    const stages = new Map<string, MergeStages>();
    let record = records.shift();
    while (record) {
      const match = record.match(/^(\d{6}) ([a-f0-9]+) ([123])\t(.+)$/s);
      if (!match) throw new Error("Unrecognized Git conflict record");
      const [, mode, sha, stage, filePath] = match as [string, string, string, string, string];
      this.filePath(filePath);
      const entry = stages.get(filePath) ?? {};
      entry[stage === "1" ? "base" : stage === "2" ? "ours" : "theirs"] = {
        mode,
        sha: this.sha(sha),
      };
      stages.set(filePath, entry);
      record = records.shift();
    }
    let unsupported = false;
    while (records[0]) {
      const count = Number(records.shift());
      if (!Number.isInteger(count) || count < 1 || count > branchConflictLimits.files)
        throw new Error("Unrecognized Git conflict message");
      const paths = records.splice(0, count);
      const kind = records.shift() ?? "";
      records.shift();
      if (!supportedConflictTypes.has(kind)) {
        unsupported = true;
        for (const filePath of paths) {
          this.filePath(filePath);
          if (!stages.has(filePath)) stages.set(filePath, {});
        }
      }
    }
    return { tree, stages, unsupported };
  }

  private decodeGitPaths(output: Buffer) {
    const decoded = output.toString();
    if (!Buffer.from(decoded).equals(output))
      throw new BranchMergeConflictError(
        "Пути файлов содержат неподдерживаемую кодировку. Разрешите конфликты в Git-провайдере.",
      );
    return decoded;
  }

  private async treeEntries(ref: string) {
    const entries = new Map<string, MergeEntry>();
    for (const record of this.decodeGitPaths(await this.run(["ls-tree", "-r", "-z", ref])).split(
      "\0",
    )) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      const filePath = record.slice(tab + 1);
      const [mode, , sha] = record.slice(0, tab).split(" ");
      if (tab < 0 || !mode || !sha) throw new Error("Unrecognized Git tree entry");
      entries.set(filePath, { mode, sha });
    }
    return entries;
  }

  private async prefetchBlobs(objects: string[]) {
    const unique = [...new Set(objects.map((object) => this.sha(object)))];
    if (!unique.length) return;
    // Checking the local cache must not trigger one network request per missing blob.
    const records = (
      await this.run(
        ["--no-lazy-fetch", "cat-file", "--batch-check=%(objectname)"],
        `${unique.join("\n")}\n`,
      )
    )
      .toString()
      .trim()
      .split("\n");
    const missing = unique.filter((object, index) => records[index] === `${object} missing`);
    if (missing.length)
      await this.run(
        [
          "-c",
          "fetch.negotiationAlgorithm=noop",
          "fetch",
          "--quiet",
          "--no-tags",
          "--no-write-fetch-head",
          "--recurse-submodules=no",
          "--filter=blob:none",
          "--stdin",
          "origin",
        ],
        `${missing.join("\n")}\n`,
      );
  }

  /** Preview only: opaque media retain identity without fetching bytes for rename similarity. */
  private async inspectionTrees(parentSha: string, sourceSha: string, baseRef?: string) {
    const bases = baseRef
      ? [baseRef]
      : (await this.run(["merge-base", "--all", parentSha, sourceSha]))
          .toString()
          .trim()
          .split("\n");
    if (bases.length !== 1 || !bases[0])
      throw new BranchMergeConflictError(
        "У веток несколько общих баз. Разрешите конфликты в Git-провайдере.",
      );
    const refs = [this.sha(bases[0]), parentSha, sourceSha];
    const trees: Map<string, MergeEntry>[] = [];
    for (const ref of refs) trees.push(await this.treeEntries(ref));
    const media = [
      ...new Set(
        trees.flatMap((tree) =>
          [...tree]
            .filter(
              ([filePath, entry]) =>
                regularFileModes.has(entry.mode) && isOpaqueMediaFile(filePath),
            )
            .map(([, entry]) => entry.sha),
        ),
      ),
    ];
    const originalObjects = new Map<string, string>();
    if (!media.length)
      return {
        baseSha: refs[0],
        parentSha,
        sourceSha,
        ours: trees[1],
        theirs: trees[2],
        originalObjects,
        mediaContentsSkipped: false,
      };
    const marksPath = path.join(this.options.directory, "inspection-media-marks");
    await this.run(
      ["fast-import", "--quiet", `--export-marks=${marksPath}`],
      media
        .map((sha, index) => {
          const content = `${sha}\0`;
          return `blob\nmark :${index + 1}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
        })
        .join(""),
    );
    const placeholders = new Map<string, string>();
    for (const record of (await readFile(marksPath, "utf8")).trim().split("\n")) {
      const [mark, object] = record.split(" ");
      const original = media[Number(mark?.slice(1)) - 1];
      if (!original || !object) throw new Error("Invalid media inspection mark");
      placeholders.set(original, this.sha(object));
      originalObjects.set(object, original);
    }
    if (placeholders.size !== media.length) throw new Error("Missing media inspection marks");
    const projected: string[] = [];
    for (const [index, ref] of refs.entries()) {
      await this.run(["read-tree", ref]);
      const records = [...(trees[index] ?? [])]
        .filter(([, entry]) => regularFileModes.has(entry.mode) && placeholders.has(entry.sha))
        .map(
          ([filePath, entry]) =>
            `${entry.mode} ${placeholders.get(entry.sha)}\t${this.filePath(filePath)}\0`,
        )
        .join("");
      if (records) await this.run(["update-index", "-z", "--index-info"], records);
      projected.push(this.sha((await this.run(["write-tree", "--missing-ok"])).toString().trim()));
    }
    return {
      baseSha: refs[0],
      baseTree: projected[0],
      parentSha: projected[1] ?? parentSha,
      sourceSha: projected[2] ?? sourceSha,
      ours: trees[1],
      theirs: trees[2],
      originalObjects,
      mediaContentsSkipped: true,
    };
  }

  async inspectConflicts(input: {
    branch: string;
    sourceBranch: string;
    rootPath?: string;
  }): Promise<BranchConflictSnapshot> {
    this.reportProgress(ConflictInspectionStage.Fetching);
    await this.initialize();
    // Discover capabilities using refs only; never silently fall back to fetching all blobs.
    const capabilities = await this.run(
      ["-c", "protocol.version=2", "ls-remote", "--heads", "origin"],
      undefined,
      undefined,
      undefined,
      true,
    );
    if (capabilities.toString() !== "filter")
      throw new BranchMergeConflictError(
        "Git-сервер не поддерживает анализ без загрузки вложений. Анализ остановлен до скачивания файлов.",
      );
    const parentSha = await this.head(input.branch);
    const sourceSha = await this.head(input.sourceBranch);
    return this.inspectCommitConflicts({ ...input, parentSha, sourceSha });
  }

  private async inspectCommitConflicts(input: {
    branch: string;
    sourceBranch: string;
    parentSha: string;
    sourceSha: string;
    baseSha?: string;
    rootPath?: string;
  }): Promise<BranchConflictSnapshot> {
    const { parentSha, sourceSha } = input;
    this.reportProgress(ConflictInspectionStage.Comparing);
    const preview = await this.inspectionTrees(parentSha, sourceSha, input.baseSha);
    const merged = await this.mergeTree(
      preview.parentSha,
      preview.sourceSha,
      preview.baseTree ?? input.baseSha,
    );
    for (const stages of merged.stages.values()) {
      for (const entry of Object.values(stages))
        entry.sha = preview.originalObjects.get(entry.sha) ?? entry.sha;
    }
    if (merged.stages.size > branchConflictLimits.files)
      throw new Error("Слишком много конфликтующих файлов. Откройте Git-провайдер.");
    const ours = preview.ours ?? new Map<string, MergeEntry>();
    const theirs = preview.theirs ?? new Map<string, MergeEntry>();
    const opaqueObjects = new Set(preview.originalObjects.values());
    let bytes = 0;
    const files: BranchConflictSnapshot["files"] = [];
    this.reportProgress(ConflictInspectionStage.Reading, {
      completed: 0,
      total: merged.stages.size,
    });
    for (const [filePath, stages] of merged.stages) {
      const sameEntry = (entry: MergeEntry | undefined, actual: MergeEntry | undefined) =>
        entry?.sha === actual?.sha && entry?.mode === actual?.mode;
      const supported =
        !merged.unsupported &&
        Object.values(stages).every((entry) => regularFileModes.has(entry.mode)) &&
        sameEntry(stages.ours, ours.get(filePath)) &&
        sameEntry(stages.theirs, theirs.get(filePath)) &&
        (!stages.ours || !stages.theirs || stages.ours.mode === stages.theirs.mode);
      const contents: Array<string | null> = [];
      let binary = Object.values(stages).some((entry) => opaqueObjects.has(entry.sha));
      for (const entry of [stages.base, stages.ours, stages.theirs]) {
        if (!entry || !supported || binary) {
          contents.push(null);
          continue;
        }
        const size = Number((await this.run(["cat-file", "-s", entry.sha])).toString());
        if (
          size > branchConflictLimits.textBytes ||
          bytes + size > branchConflictLimits.snapshotBytes
        ) {
          binary = true;
          contents.push(null);
          continue;
        }
        const content = await this.run(["cat-file", "blob", entry.sha]);
        bytes += content.length;
        if (content.includes(0) || !Buffer.from(content.toString()).equals(content)) binary = true;
        contents.push(content.toString());
      }
      let sections: BranchConflictSection[] | undefined;
      if (supported && !binary && stages.ours && stages.theirs) {
        const originals = {
          ours: contents[1] ?? "",
          base: contents[0] ?? "",
          theirs: contents[2] ?? "",
        };
        const markerSize = conflictMarkerSize(Object.values(originals));
        const base =
          stages.base?.sha ??
          (await this.run(["hash-object", "-w", "--stdin"], "")).toString().trim();
        let output: Buffer;
        try {
          output = await this.run([
            "merge-file",
            "--object-id",
            "--stdout",
            "--diff3",
            `--marker-size=${markerSize}`,
            "-L",
            "ours",
            "-L",
            "base",
            "-L",
            "theirs",
            stages.ours.sha,
            base,
            stages.theirs.sha,
          ]);
        } catch (error) {
          if (
            !(error instanceof GitCommandError) ||
            !error.exitCode ||
            error.exitCode < 1 ||
            error.exitCode > 127
          )
            throw error;
          output = error.output;
        }
        sections = parseConflictSections(output.toString(), markerSize, originals);
        bytes += Buffer.byteLength(JSON.stringify(sections));
        if (bytes > branchConflictLimits.snapshotBytes) {
          binary = true;
          sections = undefined;
        }
      }
      files.push({
        path: filePath,
        kind: !supported ? "unsupported" : binary ? "binary" : "text",
        oursExists: Boolean(stages.ours),
        theirsExists: Boolean(stages.theirs),
        baseContent: binary ? null : (contents[0] ?? null),
        oursContent: binary ? null : (contents[1] ?? null),
        theirsContent: binary ? null : (contents[2] ?? null),
        sections,
        versions: {
          base: stages.base ?? null,
          ours: stages.ours ?? null,
          theirs: stages.theirs ?? null,
        },
      });
      this.reportProgress(ConflictInspectionStage.Reading, {
        completed: files.length,
        total: merged.stages.size,
      });
    }
    const mediaFiles = files.filter((file) => isOpaqueMediaFile(file.path));
    if (mediaFiles.length) {
      const references = await this.mediaReferences(
        parentSha,
        sourceSha,
        mediaFiles.map((file) => file.path),
        input.rootPath ?? ".",
      );
      for (const file of mediaFiles)
        file.mediaReferences = {
          complete: references.complete,
          articles: references.articles
            .filter((article) => article.assets.includes(file.path))
            .map(({ version, path, title }) => ({ version, path, title })),
        };
    }
    return {
      branch: input.branch,
      sourceBranch: input.sourceBranch,
      inspectionVersion: branchConflictCache.version,
      history: {
        base: await this.commitVersion(preview.baseSha ?? ""),
        branch: await this.commitVersion(parentSha),
        target: await this.commitVersion(sourceSha),
      },
      ...(preview.mediaContentsSkipped ? { mediaContentsSkipped: true } : {}),
      parentSha,
      sourceSha,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      ...(merged.unsupported || files.some((file) => file.kind === "unsupported")
        ? {
            unsupportedReason:
              "Конфликт затрагивает переименование, структуру каталогов или специальные файлы. Разрешите его в Git-провайдере.",
          }
        : {}),
    };
  }

  private async mediaReferences(
    parentSha: string,
    sourceSha: string,
    assets: string[],
    rootPath: string,
  ) {
    const root = rootPath === "." ? "" : `${rootPath.replace(/^\/+|\/+$/g, "")}/`;
    const articles: Array<{
      version: "branch" | "target";
      path: string;
      title: string;
      assets: string[];
    }> = [];
    let complete = true;
    let bytes = 0;
    for (const [version, sha] of [
      ["branch", parentSha],
      ["target", sourceSha],
    ] as const) {
      const tree = await this.treeEntries(sha);
      const configEntry = tree.get(`${root}${projectConfigPaths.config}`);
      let config: ReturnType<typeof parseProjectConfig>;
      try {
        if (configEntry) await this.prefetchBlobs([configEntry.sha]);
        config = parseProjectConfig(
          configEntry
            ? (await this.run(["cat-file", "blob", configEntry.sha])).toString()
            : undefined,
        );
      } catch {
        complete = false;
        continue;
      }
      const paths = [...tree.keys()]
        .filter((filePath) => filePath.startsWith(root))
        .map((filePath) => filePath.slice(root.length));
      const documents = [...tree].filter(
        ([filePath, entry]) =>
          regularFileModes.has(entry.mode) &&
          filePath.startsWith(root) &&
          /\.mdx?$/i.test(filePath) &&
          config.documentRoots.some((dir) => filePath.slice(root.length).startsWith(`${dir}/`)),
      );
      if (documents.length > conflictReportLimits.referenceDocs) complete = false;
      const selected = documents.slice(0, conflictReportLimits.referenceDocs);
      await this.prefetchBlobs(selected.map(([, entry]) => entry.sha));
      const files: Array<{ path: string; content: string; status: string }> = [];
      for (const [filePath, entry] of selected) {
        const size = Number((await this.run(["cat-file", "-s", entry.sha])).toString());
        if (
          size > branchConflictLimits.textBytes ||
          bytes + size > conflictReportLimits.referenceBytes
        ) {
          complete = false;
          continue;
        }
        const content = (await this.run(["cat-file", "blob", entry.sha])).toString();
        bytes += size;
        files.push({ path: filePath.slice(root.length), content, status: "clean" });
      }
      const wanted = assets
        .filter((filePath) => filePath.startsWith(root))
        .map((filePath) => filePath.slice(root.length));
      const usages = mediaUsages(config, [...new Set([...paths, ...wanted])], files);
      for (const file of files) {
        const used = wanted
          .filter((asset) => usages.get(asset)?.includes(file.path))
          .map((asset) => `${root}${asset}`);
        if (!used.length) continue;
        let title = file.content.match(/^#\s+(.+)$/m)?.[1] ?? file.path;
        try {
          const value = readMetadata(file.content).values.title;
          if (typeof value === "string") title = value;
        } catch {
          /* The plain-text heading remains available for unsupported frontmatter. */
        }
        articles.push({ version, path: `${root}${file.path}`, title, assets: used });
      }
    }
    return { complete, articles };
  }

  private async commitVersion(sha: string) {
    this.sha(sha);
    const value = (await this.run(["show", "-s", "--format=%cI", sha])).toString().trim();
    return { sha, committedAt: Number.isFinite(Date.parse(value)) ? value : null };
  }

  /** Merge full Git trees without checking out files or executing repository configuration. */
  private async resolvedTree(
    merged: Awaited<ReturnType<GitTransport["mergeTree"]>>,
    snapshot: BranchConflictSnapshot,
    files: BranchConflictResolution,
  ) {
    if (
      snapshot.unsupportedReason ||
      !snapshot.files.length ||
      snapshot.files.some((file) => file.kind === "unsupported")
    )
      throw new BranchMergeConflictError("Этот конфликт нужно разрешить в Git-провайдере.");
    if (
      merged.unsupported ||
      files.length !== merged.stages.size ||
      new Set(files.map((file) => file.path)).size !== files.length
    )
      throw new BranchMergeConflictError(
        snapshot.mediaContentsSkipped
          ? conflictVerificationMessage
          : "Нужно выбрать решение для каждого конфликтующего файла.",
      );
    await this.run(["read-tree", merged.tree]);
    for (const file of files) {
      const stages = merged.stages.get(file.path);
      const inspected = snapshot.files.find((item) => item.path === file.path);
      if (!stages || !inspected)
        throw new BranchMergeConflictError(
          snapshot.mediaContentsSkipped
            ? conflictVerificationMessage
            : "Неизвестный конфликтующий файл",
        );
      if (
        inspected.versions &&
        (["base", "ours", "theirs"] as const).some(
          (side) =>
            inspected.versions?.[side]?.sha !== stages[side]?.sha ||
            inspected.versions?.[side]?.mode !== stages[side]?.mode,
        )
      )
        throw new BranchMergeConflictError(conflictVerificationMessage);
      let entry = file.choice === BranchConflictChoice.Ours ? stages.ours : stages.theirs;
      if (file.choice === BranchConflictChoice.Manual) {
        if (
          inspected.kind !== "text" ||
          file.content === undefined ||
          Buffer.byteLength(file.content) > branchConflictLimits.textBytes
        )
          throw new BranchMergeConflictError("Недопустимый ручной результат");
        const mode = stages.ours?.mode ?? stages.theirs?.mode;
        if (!mode) throw new BranchMergeConflictError("Недопустимый конфликтующий файл");
        entry = {
          mode,
          sha: (await this.run(["hash-object", "-w", "--stdin"], file.content)).toString().trim(),
        };
      }
      if (entry)
        await this.run([
          "update-index",
          "--add",
          "--cacheinfo",
          entry.mode,
          entry.sha,
          this.filePath(file.path),
        ]);
      else
        await this.run(
          ["update-index", "-z", "--index-info"],
          `0 ${"0".repeat(merged.tree.length)}\t${this.filePath(file.path)}\0`,
        );
    }
    return (await this.run(["write-tree", "--missing-ok"])).toString().trim();
  }

  async prepareMerge(input: {
    branch: string;
    sourceBranch: string;
    createdAt: string;
    prepared?: PreparedBranchMerge;
    resolution?: { snapshot: BranchConflictSnapshot; files: BranchConflictResolution };
  }): Promise<PreparedBranchMerge> {
    validateBranchName(input.branch);
    validateBranchName(input.sourceBranch);
    if (input.branch === input.sourceBranch) throw new Error("Нельзя влить ветку в саму себя");
    if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Invalid commit identity");
    const current = await this.head(input.branch);
    const parentSha = input.prepared
      ? this.sha(input.prepared.parentSha)
      : input.resolution
        ? this.sha(input.resolution.snapshot.parentSha)
        : current;
    const sourceSha = input.prepared
      ? this.sha(input.prepared.sourceSha)
      : input.resolution
        ? this.sha(input.resolution.snapshot.sourceSha)
        : await this.head(input.sourceBranch);
    if (
      input.resolution &&
      !input.prepared &&
      (current !== parentSha || (await this.head(input.sourceBranch)) !== sourceSha)
    )
      throw new ProviderConflictError("Ветки обновились. Заново получите список конфликтов.");
    if (input.prepared) {
      if (input.prepared.branch !== input.branch) throw new Error("Prepared merge branch mismatch");
      this.sha(input.prepared.sha);
      // A cache can be lost between attempts. Fetch the original objects, never moving branch tips.
      for (const sha of [parentSha, sourceSha]) {
        try {
          await this.run(["cat-file", "-e", `${sha}^{commit}`]);
        } catch {
          await this.run(["fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", sha]);
        }
      }
    }
    try {
      await this.run(["merge-base", "--is-ancestor", sourceSha, parentSha]);
      return { branch: input.branch, parentSha, sourceSha, sha: parentSha };
    } catch (error) {
      if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
    }
    try {
      await this.run(["merge-base", "--is-ancestor", parentSha, sourceSha]);
      return { branch: input.branch, parentSha, sourceSha, sha: sourceSha };
    } catch (error) {
      if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
    }
    let tree: string;
    if (input.resolution) {
      tree = await this.resolvedTree(
        await this.mergeTree(parentSha, sourceSha),
        input.resolution.snapshot,
        input.resolution.files,
      );
    } else {
      try {
        tree =
          (await this.run(["merge-tree", "--write-tree", parentSha, sourceSha]))
            .toString()
            .split("\n")[0]
            ?.trim() ?? "";
      } catch (error) {
        if (error instanceof GitCommandError && error.exitCode === 1)
          throw new BranchMergeConflictError(
            "Ветки содержат конфликтующие изменения. Разрешите конфликт в Git и обновите ветку в PushDocs. Ветка в Git не изменена.",
          );
        throw error;
      }
    }
    this.sha(tree);
    const sha = (
      await this.run(
        ["commit-tree", tree, "-p", parentSha, "-p", sourceSha],
        `Merge ${input.sourceBranch} into ${input.branch}\n`,
        input.createdAt,
      )
    )
      .toString()
      .trim();
    return { branch: input.branch, parentSha, sourceSha, sha };
  }

  async prepareUpdate(input: {
    branch: string;
    sourceBranch: string;
    strategy: BranchUpdateStrategy;
    createdAt: string;
    prepared?: PreparedBranchUpdate;
    rebase?: RebaseProgress;
    operationId?: string;
    rootPath?: string;
  }): Promise<PreparedBranchUpdate> {
    validateBranchName(input.branch);
    validateBranchName(input.sourceBranch);
    if (input.branch === input.sourceBranch) throw new BranchMergeConflictError("Ветки совпадают");
    if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Invalid commit identity");
    const saved = input.prepared;
    const resume = input.rebase;
    if (
      resume &&
      (input.strategy !== BranchUpdateStrategy.Rebase ||
        resume.version !== branchUpdateLimits.version ||
        resume.branch !== input.branch ||
        resume.sourceBranch !== input.sourceBranch ||
        Buffer.byteLength(JSON.stringify(resume.resolutions)) > branchUpdateLimits.resolutionBytes)
    )
      throw new BranchMergeConflictError("План продолжения rebase несовместим.");
    const original = saved ?? resume;
    if (
      saved &&
      (saved.version !== branchUpdateLimits.version ||
        saved.strategy !== input.strategy ||
        saved.branch !== input.branch ||
        saved.sourceBranch !== input.sourceBranch)
    )
      throw new BranchMergeConflictError("План обновления несовместим. Отправка остановлена.");
    await this.initialize();
    const parentSha = original ? this.sha(original.parentSha) : await this.head(input.branch);
    const sourceSha = original ? this.sha(original.sourceSha) : await this.head(input.sourceBranch);
    for (const [ref, sha] of [
      ["original", parentSha],
      ["target", sourceSha],
    ] as const) {
      if (original) {
        try {
          await this.run(["cat-file", "-e", `${sha}^{commit}`]);
        } catch {
          await this.run(["fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", sha]);
        }
      }
      await this.run(["update-ref", `refs/pushdocs/update/${ref}`, sha]);
    }
    let sha = parentSha;
    const commits: PreparedBranchUpdate["commits"] = [];
    if (input.strategy === BranchUpdateStrategy.Merge) {
      sha = (
        await this.prepareMerge({
          branch: input.branch,
          sourceBranch: input.sourceBranch,
          createdAt: input.createdAt,
          prepared: { branch: input.branch, parentSha, sourceSha, sha: saved?.sha ?? parentSha },
        })
      ).sha;
    } else {
      let bases: string[];
      try {
        bases = (await this.run(["merge-base", "--all", parentSha, sourceSha]))
          .toString()
          .trim()
          .split("\n");
      } catch (error) {
        if (error instanceof GitCommandError && error.exitCode === 1)
          throw new BranchMergeConflictError(
            "У веток нет общей истории. Автоматический rebase остановлен.",
          );
        throw error;
      }
      if (bases.length !== 1 || !bases[0])
        throw new BranchMergeConflictError("История веток не поддерживает автоматический rebase.");
      const base = this.sha(bases[0]);
      if (base !== sourceSha) {
        sha = sourceSha;
        const range = (await this.run(["rev-list", "--reverse", `${sourceSha}..${parentSha}`]))
          .toString()
          .trim();
        const originals = range ? range.split("\n") : [];
        if (resume && JSON.stringify(originals) !== JSON.stringify(resume.originals))
          throw new BranchMergeConflictError(
            "Не удалось восстановить последовательность коммитов rebase.",
          );
        const resolutions = resume?.resolutions ?? [];
        if (
          new Set(resolutions.map((resolution) => resolution.commitSha)).size !==
            resolutions.length ||
          resolutions.some((resolution) => !originals.includes(resolution.commitSha))
        )
          throw new BranchMergeConflictError("Недопустимый журнал решений rebase.");
        if (originals.length > branchUpdateLimits.commits)
          throw new BranchMergeConflictError("Слишком много коммитов для автоматического rebase.");
        let previous = base;
        // Validate the entire chain before preparing any replacement commit.
        for (const original of originals) {
          this.sha(original);
          const parents = (await this.run(["rev-list", "--parents", "-n", "1", original]))
            .toString()
            .trim()
            .split(" ");
          if (parents.length !== 2 || parents[1] !== previous)
            throw new BranchMergeConflictError(
              "В ветке есть merge-коммиты. Автоматический rebase остановлен, ветка в Git не изменена.",
            );
          previous = original;
        }
        previous = base;
        for (const originalSha of originals) {
          const merged = await this.mergeTree(sha, originalSha, previous);
          let tree = merged.tree;
          const resolution = resolutions.find((item) => item.commitSha === originalSha);
          if (merged.unsupported)
            throw new BranchMergeConflictError(
              "Конфликт rebase затрагивает неподдерживаемые типы файлов или переименования.",
            );
          if (merged.stages.size) {
            const conflictId = `${originalSha}:${sha}:${merged.tree}`;
            const snapshot = await this.inspectCommitConflicts({
              branch: input.branch,
              sourceBranch: input.sourceBranch,
              parentSha: sha,
              sourceSha: originalSha,
              baseSha: previous,
              rootPath: input.rootPath,
            });
            if (resolution) {
              if (resolution.conflictId !== conflictId)
                throw new BranchMergeConflictError(
                  "Контекст разрешённого конфликта rebase изменился.",
                );
              tree = await this.resolvedTree(merged, snapshot, resolution.files);
            } else {
              snapshot.parentSha = parentSha;
              snapshot.sourceSha = sourceSha;
              snapshot.rebase = {
                operationId: input.operationId ?? "",
                conflictId,
                commitSha: originalSha,
                currentParentSha: sha,
                originalParentSha: previous,
                index: commits.length + 1,
                total: originals.length,
                title: (await this.run(["show", "-s", "--format=%s", originalSha]))
                  .toString()
                  .trim()
                  .slice(0, conflictReportLimits.titleChars),
              };
              throw new RebaseNeedsResolution(
                {
                  version: branchUpdateLimits.version,
                  branch: input.branch,
                  sourceBranch: input.sourceBranch,
                  parentSha,
                  sourceSha,
                  originals,
                  commits,
                  resolutions,
                },
                snapshot,
              );
            }
          } else if (resolution) {
            throw new BranchMergeConflictError(
              "Не удалось воспроизвести разрешённый конфликт rebase.",
            );
          }
          const raw = await this.run(["cat-file", "commit", originalSha]);
          const separator = raw.indexOf("\n\n");
          const header = raw.subarray(0, separator).toString();
          const message = raw.subarray(separator + 2);
          if (
            separator < 0 ||
            !Buffer.from(header).equals(raw.subarray(0, separator)) ||
            !Buffer.from(message.toString()).equals(message) ||
            /^encoding (?!utf-8$)/im.test(header)
          )
            throw new BranchMergeConflictError(
              "Кодировка коммита не поддерживает автоматический rebase.",
            );
          const author = header.match(/^author (.*) <([^<>\n]*)> (\d+ [+-]\d{4})$/m);
          if (!author) throw new BranchMergeConflictError("Не удалось прочитать автора коммита.");
          sha = (
            await this.run(["commit-tree", tree, "-p", sha], message, input.createdAt, {
              name: author[1] ?? "",
              email: author[2] ?? "",
              date: author[3] ?? "",
            })
          )
            .toString()
            .trim();
          this.sha(sha);
          const checkpoint = resume?.commits[commits.length];
          if (checkpoint && (checkpoint.originalSha !== originalSha || checkpoint.sha !== sha))
            throw new BranchMergeConflictError(
              "Не удалось восстановить промежуточный коммит rebase.",
            );
          commits.push({ originalSha, sha });
          await this.run(["update-ref", `refs/pushdocs/update/commits/${commits.length}`, sha]);
          previous = originalSha;
        }
      }
    }
    const result: PreparedBranchUpdate = {
      version: branchUpdateLimits.version,
      strategy: input.strategy,
      branch: input.branch,
      sourceBranch: input.sourceBranch,
      parentSha,
      sourceSha,
      sha,
      commits,
    };
    if (saved && (saved.sha !== sha || JSON.stringify(saved.commits) !== JSON.stringify(commits)))
      throw new BranchMergeConflictError("Не удалось восстановить прежний результат обновления.");
    await this.run(["update-ref", "refs/pushdocs/update/result", sha]);
    return result;
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

  async isPublished(prepared: PreparedCommit): Promise<boolean> {
    const current = await this.head(prepared.branch);
    if (current === this.sha(prepared.sha)) return true;
    try {
      await this.run(["cat-file", "-e", `${prepared.sha}^{commit}`]);
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 128) return false;
      throw error;
    }
    try {
      await this.run(["merge-base", "--is-ancestor", prepared.sha, current]);
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) return false;
      throw error;
    }
  }
}
