// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CreateConnectionDialog } from "./create-connection-dialog";

afterEach(cleanup);

it("opens the connection form and closes it without changes", () => {
  render(
    <CreateConnectionDialog>
      <p>Connection fields</p>
    </CreateConnectionDialog>,
  );

  const trigger = screen.getByRole("button", { name: "Создать подключение" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Connection fields")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
