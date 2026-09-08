// @vitest-environment jsdom

import { parseProjectConfig } from "@pushdocs/content";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { MetadataEditor } from "./metadata-editor";

afterEach(cleanup);
function Example({ source = "# Body", readOnly = false }) {
  const [value, setValue] = useState(source);
  return (
    <>
      <MetadataEditor
        value={value}
        fields={parseProjectConfig().metadata}
        readOnly={readOnly}
        onChange={setValue}
      />
      <output>{value}</output>
    </>
  );
}
it("updates configured scalar fields and retains unknown metadata and body", () => {
  render(<Example source={"---\ntitle: Old # keep\ncustom: [one, two]\n---\n<Widget />"} />);
  fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Позиция в меню"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Позиция в меню"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Позиция в меню"), { target: { value: "1e309" } });
  fireEvent.change(screen.getByLabelText("Черновик Docusaurus"), { target: { value: "true" } });
  expect(screen.getByRole("status").textContent).toBe(
    '---\ntitle: "New" # keep\ncustom: [one, two]\nsidebar_position: 2\ndraft: true\n---\n<Widget />',
  );
});
it("marks unsupported values and syntax as source-only, with no changes for a reader", () => {
  const { rerender } = render(
    <Example source={"---\ndescription: |\n  More text\n---\n# Body"} readOnly />,
  );
  expect((screen.getByLabelText("Заголовок") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/Сложное значение/)).toBeTruthy();
  rerender(
    <MetadataEditor
      value={"---javascript\n1 + 1\n---"}
      fields={parseProjectConfig().metadata}
      readOnly={false}
      onChange={() => {
        throw new Error("Must not change");
      }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("исходник");
  expect(screen.queryByLabelText("Заголовок")).toBeNull();
});
