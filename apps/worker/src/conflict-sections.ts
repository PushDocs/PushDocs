import type { BranchConflictSection } from "@pushdocs/contracts";

// A marker wider than every marker run in the inputs cannot be document text.
export function conflictMarkerSize(contents: string[]) {
  let size = 7;
  for (const content of contents) {
    for (const match of content.matchAll(/^[<|=>]+/gm)) size = Math.max(size, match[0].length + 1);
  }
  return size;
}

export function parseConflictSections(
  merged: string,
  markerSize: number,
  originals: { ours: string; base: string; theirs: string },
): BranchConflictSection[] {
  const markers = [
    `${"<".repeat(markerSize)} ours`,
    `${"|".repeat(markerSize)} base`,
    "=".repeat(markerSize),
    `${">".repeat(markerSize)} theirs`,
  ];
  const sections: BranchConflictSection[] = [];
  let text = "";
  let conflict: Extract<BranchConflictSection, { kind: "conflict" }> | undefined;
  let side: "ours" | "base" | "theirs" = "ours";
  for (const line of merged.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = markers.indexOf(line.replace(/\r?\n$/, ""));
    if (marker === 0 && !conflict) {
      if (text) sections.push({ kind: "text", content: text });
      text = "";
      conflict = { kind: "conflict", ours: "", base: "", theirs: "" };
      side = "ours";
    } else if (marker === 1 && conflict && side === "ours") side = "base";
    else if (marker === 2 && conflict && side === "base") side = "theirs";
    else if (marker === 3 && conflict && side === "theirs") {
      sections.push(conflict);
      conflict = undefined;
    } else if (marker !== -1) throw new Error("Unrecognized Git conflict markers");
    else if (conflict) conflict[side] += line;
    else text += line;
  }
  if (conflict) throw new Error("Incomplete Git conflict markers");
  if (text) sections.push({ kind: "text", content: text });
  const last = sections.at(-1);
  if (last?.kind === "conflict") {
    // Git adds a line ending before markers even when the source ends without one.
    for (const side of ["ours", "base", "theirs"] as const) {
      if (!originals[side].endsWith("\n") && last[side].endsWith("\n")) {
        const withoutLf = last[side].slice(0, -1);
        last[side] = originals[side].endsWith(withoutLf) ? withoutLf : withoutLf.replace(/\r$/, "");
      }
    }
  }
  if (!sections.some((section) => section.kind === "conflict"))
    throw new Error("Git did not return the expected conflict fragments");
  return sections;
}
