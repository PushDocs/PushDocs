import { expect, it } from "vitest";
import { externalPreviewUrl } from "./external-preview";

it("builds provider preview URLs from review number placeholders", () => {
  expect(externalPreviewUrl("https://pr-{MR_NUMBER}.docs.example.test/", "42")).toBe(
    "https://pr-42.docs.example.test/",
  );
  expect(externalPreviewUrl("https://docs.example.test/pr/{PR_NUMBER}", "7")).toBe(
    "https://docs.example.test/pr/7",
  );
  expect(externalPreviewUrl("https://docs.example.test/{REVIEW_NUMBER}", "9")).toBe(
    "https://docs.example.test/9",
  );
});

it("ignores missing, invalid and unsafe preview templates", () => {
  expect(externalPreviewUrl(undefined, "42")).toBeUndefined();
  expect(externalPreviewUrl("https://docs.example.test/", "42")).toBeUndefined();
  expect(externalPreviewUrl("javascript:{MR_NUMBER}", "42")).toBeUndefined();
  expect(externalPreviewUrl("not a URL {MR_NUMBER}", "42")).toBeUndefined();
});
