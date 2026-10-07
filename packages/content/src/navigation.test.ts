import { describe, expect, it } from "vitest";
import { editNavigation, navigationTree, parseNavigation } from "./navigation";

const source =
  '// header\nconst sidebars = {docs: ["intro", {type: "category", label: "Account", items: ["users"]}]};\nexport default sidebars;\n';
describe("static navigation", () => {
  it("parses without executing JavaScript and preserves outer bytes", () => {
    const parsed = parseNavigation(source);
    expect(navigationTree(parsed.value)[0]?.children?.[1]?.children?.[0]?.document).toBe("users");
    const updated = editNavigation(source, {
      action: "add",
      parent: "docs/1",
      document: "sublogins",
      position: 1,
    });
    expect(updated.startsWith("// header\nconst sidebars = ")).toBe(true);
    expect(updated.endsWith(";\nexport default sidebars;\n")).toBe(true);
    expect(
      navigationTree(parseNavigation(updated).value)[0]?.children?.[1]?.children?.map(
        (i) => i.document,
      ),
    ).toEqual(["users", "sublogins"]);
  });
  it("moves and removes items without changing documents", () => {
    const moved = editNavigation(source, {
      action: "move",
      item: "docs/1/items/0",
      parent: "docs",
      position: 0,
    });
    expect(navigationTree(parseNavigation(moved).value)[0]?.children?.[0]?.document).toBe("users");
    const removed = editNavigation(source, { action: "remove", item: "docs/0" });
    expect(parseNavigation(removed).value.docs?.length).toBe(1);
  });
  it.each([
    'module.exports = require("secret")',
    "module.exports = {docs: [...items]}",
    "module.exports = {docs: [process.exit()]}",
    "danger(); export default {docs: []}",
    "export default {docs: [,,]}",
  ])("rejects dynamic or ambiguous config: %s", (input) => {
    expect(() => parseNavigation(input)).toThrow("Only static");
  });
  it("rejects category cycles", () => {
    expect(() =>
      editNavigation(source, { action: "move", item: "docs/1", parent: "docs/1/items/0" }),
    ).toThrow("cycle");
  });
});
