import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let bytes: Buffer;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
  bytes = await readFile("tests/fixtures/video-preview.mp4");
});
test.afterAll(async () => {
  await fixture.close();
});
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/projects\/p\/assets\?/, (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = Number(range?.[1] ?? 0);
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/mp4",
      headers: {
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
});

test("shows a decoded frame, plays and seeks an opened MP4", async ({ page }, testInfo) => {
  await page.goto(`${fixture.url}/?video`);
  const video = page.getByLabel("Видео demo.mp4");
  await expect(page.locator('.asset-video[data-ready="true"]')).toBeVisible();
  expect(await video.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(160);
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeGreaterThan(0.3);
  await video.evaluate((node: HTMLVideoElement) => {
    node.pause();
    node.currentTime = 1.2;
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.seeking)).toBe(false);
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(1.2);
  await page.screenshot({ path: testInfo.outputPath("mp4-player.png") });
});

test("shows a video frame in the library and defers offscreen thumbnails", async ({
  page,
}, testInfo) => {
  const paths = Array.from({ length: 24 }, (_, index) => `static/video/demo-${index}.mp4`);
  const requested: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/assets")) requested.push(url.searchParams.get("path") ?? "");
  });
  await page.route("**/api/projects/p/media?*", (route) =>
    route.fulfill({
      json: {
        assets: paths.map((path) => ({
          path,
          url: `/video/${path.split("/").at(-1)}`,
          canDelete: true,
          inRepository: true,
          status: "clean",
          size: null,
          usages: [],
        })),
        directories: ["static/video"],
        uploadDirectory: "static/video",
        revision: 1,
        status: "open",
        role: "editor",
        locale: "ru",
      },
    }),
  );
  await page.goto(`${fixture.url}/?media&docmedia`);
  const first = page.getByRole("figure", { name: "Превью видео demo-0.mp4", exact: true });
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("data-ready", "true");
  const video = first.locator("video");
  expect(
    await video.evaluate((node: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 9;
      const context = canvas.getContext("2d");
      context?.drawImage(node, 0, 0, 16, 9);
      return context
        ?.getImageData(0, 0, 16, 9)
        .data.some((value, index) => index % 4 !== 3 && value > 50);
    }),
  ).toBe(true);
  expect(
    await video.evaluate((node: HTMLVideoElement) => node.paused && node.muted && !node.controls),
  ).toBe(true);
  expect(requested).not.toContain(paths.at(-1));
  await page.screenshot({ path: testInfo.outputPath("mp4-thumbnails.png") });
  const last = page.getByRole("figure", { name: "Превью видео demo-23.mp4", exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute("data-ready", "true");
  expect(requested).toContain(paths.at(-1));
});
