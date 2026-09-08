import { expect, it } from "vitest";
import { readJsonBody } from "./request-body";

it("reads JSON without trusting Content-Length", async () => {
  expect(
    await readJsonBody(new Request("https://test", { method: "POST", body: '{"a":1}' }), 7),
  ).toEqual({ a: 1 });
  await expect(
    readJsonBody(new Request("https://test", { method: "POST", body: '{"a":12}' }), 7),
  ).rejects.toThrow("большой");
});
it("rejects missing, oversized and malformed request bodies", async () => {
  await expect(readJsonBody(new Request("https://test"))).rejects.toThrow();
  await expect(
    readJsonBody(
      new Request("https://test", {
        method: "POST",
        body: "{}",
        headers: { "Content-Length": "100" },
      }),
      10,
    ),
  ).rejects.toThrow();
  await expect(
    readJsonBody(new Request("https://test", { method: "POST", body: "{" })),
  ).rejects.toThrow();
});
