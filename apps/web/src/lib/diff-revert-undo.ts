import "server-only";
import { decryptSecret, encryptSecret } from "@pushdocs/db";
import { z } from "zod";
import { textDiffLimits } from "@/components/text-diff";
import { type RevertEdit, textEdits } from "./diff-revert-state";

// JSON escaping and base64 can expand a source character to eight token characters.
const tokenCharacters = textDiffLimits.characters * 16 + textDiffLimits.lines * 128 + 1024;
export const diffRevertUndoLimits = {
  tokenCharacters,
  requestBytes: tokenCharacters + 64_000,
} as const;

const snapshot = z.object({
  changeSetId: z.string().min(1),
  headSha: z.string().min(1),
  content: z.string().nullable(),
  after: z.string().nullable(),
  blocks: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        text: z.string(),
      }),
    )
    .min(1),
});

type Scope = { projectId: string; userId: string; branch: string; path: string };
const context = ({ projectId, userId, branch, path }: Scope) =>
  JSON.stringify(["diff-revert-undo", projectId, userId, branch, path]);

export function createDiffRevertUndo(
  scope: Scope,
  value: Omit<z.infer<typeof snapshot>, "blocks"> & { blocks?: RevertEdit[] },
) {
  const blocks = value.blocks ?? textEdits(value.after ?? "", value.content ?? "");
  return encryptSecret(
    JSON.stringify({ ...value, blocks: blocks.length ? blocks : [{ start: 0, end: 0, text: "" }] }),
    context(scope),
  );
}

export function readDiffRevertUndo(scope: Scope, token: string) {
  return snapshot.parse(JSON.parse(decryptSecret(token, context(scope))));
}
