// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FilePicker } from "./file-picker";

afterEach(cleanup);
it("keeps the file input accessible and passes selected files to the consumer", () => {
  const change = vi.fn();
  render(
    <FilePicker aria-label="Профиль OpenVPN" name="vpnProfile" accept=".ovpn" onChange={change} />,
  );
  const input = screen.getByLabelText("Профиль OpenVPN") as HTMLInputElement;
  const file = new File(["profile"], "company.ovpn");
  Object.defineProperty(input, "value", { configurable: true, value: "company.ovpn" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(change).toHaveBeenCalledOnce();
  expect(input.files?.[0]).toBe(file);
  expect(input.name).toBe("vpnProfile");
  expect(screen.getByText("company.ovpn")).toBeTruthy();
});
it("displays its empty state when an uploader clears the selection", () => {
  render(
    <FilePicker
      aria-label="Файлы"
      multiple
      onChange={(event) => {
        event.currentTarget.value = "";
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Файлы"), {
    target: { files: [new File(["a"], "a.txt")] },
  });
  expect(screen.getByText("Файл не выбран")).toBeTruthy();
});
