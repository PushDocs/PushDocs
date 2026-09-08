/** Apply the browser's normalized textarea value without rewriting untouched repository bytes. */
export function applyEditorInput(source: string, input: string): string {
  const before = source.replace(/\r\n?/g, "\n");
  const after = input.replace(/\r\n?/g, "\n");
  if (before === after) return source;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const originalOffset = (offset: number) => {
    let raw = 0;
    for (let index = 0; index < offset; index++, raw++)
      if (source[raw] === "\r" && source[raw + 1] === "\n") raw++;
    return raw;
  };
  const separator = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  return (
    source.slice(0, originalOffset(start)) +
    after.slice(start, endAfter).replace(/\n/g, separator) +
    source.slice(originalOffset(endBefore))
  );
}
