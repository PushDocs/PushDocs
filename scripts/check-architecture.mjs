import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packages = ["contracts", "domain", "core", "db", "providers", "content", "ui", "vpn"];
const allowed = {
  contracts: [],
  domain: ["contracts"],
  core: ["contracts", "domain"],
  db: ["contracts", "domain"],
  providers: ["contracts"],
  content: ["contracts"],
  ui: [],
  vpn: [],
};

const violations = [];
for (const packageName of packages) {
  const sourceRoot = path.join(root, "packages", packageName, "src");
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/@pushdocs\/([a-z-]+)/g)) {
      const dependency = match[1];
      if (!allowed[packageName].includes(dependency)) {
        violations.push(
          `${path.relative(root, file)} imports @pushdocs/${dependency}, which is outside its allowed dependencies`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Architecture dependencies are valid.");
