// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SourceEditor } from "./source-editor";

afterEach(cleanup);
it("restores cursor and both scroll offsets separately for each file", () => {
  sessionStorage.clear();
  const props = {
    value: "First\nSecond\nThird\n",
    onChange: vi.fn(),
    onSave: vi.fn(),
    onIndent: vi.fn(),
    readOnly: false,
    inputRef: createRef<HTMLTextAreaElement>(),
  };
  render(<SourceEditor {...props} storageKey="a" />);
  const input = screen.getByLabelText("Исходник документа") as HTMLTextAreaElement;
  input.setSelectionRange(7, 10);
  fireEvent.scroll(input, { target: { scrollTop: 48, scrollLeft: 80 } });
  cleanup();
  render(<SourceEditor {...props} storageKey="b" />);
  expect(props.inputRef.current?.scrollTop).toBe(0);
  cleanup();
  render(<SourceEditor {...props} storageKey="a" />);
  expect(props.inputRef.current?.selectionStart).toBe(7);
  expect(props.inputRef.current?.selectionEnd).toBe(10);
  expect(props.inputRef.current?.scrollTop).toBe(48);
  expect(props.inputRef.current?.scrollLeft).toBe(80);
  expect(screen.getByTestId("source-highlight").style.transform).toBe("translate(-80px, -48px)");
});
it("focuses the requested original source line", () => {
  const ref = createRef<HTMLTextAreaElement>();
  render(
    <SourceEditor
      value={"First\nSecond\nThird"}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={vi.fn()}
      readOnly={false}
      inputRef={ref}
      jump={{ line: 3, token: 1 }}
    />,
  );
  expect(document.activeElement).toBe(ref.current);
  expect(ref.current?.selectionStart).toBe(13);
});
it("shows line numbers and syntax while keeping keyboard editing and CRLF bytes intact", () => {
  const change = vi.fn();
  const save = vi.fn();
  const insert = vi.fn();
  const ref = createRef<HTMLTextAreaElement>();
  render(
    <SourceEditor
      value={'# Title\r\n<Widget value="x" />\r\n'}
      onChange={change}
      onSave={save}
      onIndent={insert}
      readOnly={false}
      inputRef={ref}
    />,
  );
  expect(screen.getByTestId("source-lines").textContent).toBe("1\n2\n3");
  expect(screen.getByTestId("source-highlight").textContent).toBe(
    '# Title\n<Widget value="x" />\n',
  );
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: '# Updated\n<Widget value="x" />\n' },
  });
  expect(change).toHaveBeenCalledWith('# Updated\r\n<Widget value="x" />\r\n');
  fireEvent.keyDown(screen.getByLabelText("Исходник документа"), { key: "s", ctrlKey: true });
  expect(save).toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Исходник документа"), { key: "Tab" });
  expect(insert).toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Исходник документа"), { key: "s", metaKey: true });
  expect(save).toHaveBeenCalledTimes(2);
  fireEvent.scroll(screen.getByLabelText("Исходник документа"), {
    target: { scrollLeft: 30, scrollTop: 48 },
  });
  expect(screen.getByTestId("source-highlight").style.transform).toBe("translate(-30px, -48px)");
  expect(screen.getByTestId("source-lines").style.transform).toBe("translateY(-48px)");
});
it("keeps plain text usable for large files and does not indent read-only files", () => {
  const indent = vi.fn();
  const source = "import Example from 'example';\n".repeat(8000);
  render(
    <SourceEditor
      value={source}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={indent}
      readOnly
      inputRef={createRef<HTMLTextAreaElement>()}
    />,
  );
  expect(screen.getByTestId("source-highlight").textContent).toBe(source);
  expect(screen.getByTestId("source-highlight").querySelector("span")).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("Исходник документа"), { key: "Tab" });
  expect(indent).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).readOnly).toBe(true);
});
