import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    coverage: {
      exclude: ["**/*.test.{ts,tsx}", "**/migrate.ts", "**/migrations.ts", "**/schema.ts"],
      include: [
        "packages/{content,contracts,core,domain,providers}/src/index.ts",
        "packages/content/src/config.ts",
        "packages/content/src/media.ts",
        "packages/content/src/editing.ts",
        "packages/content/src/metadata.ts",
        "packages/db/src/{crypto,database,events,repository}.ts",
        "packages/ui/src/index.tsx",
        "apps/worker/src/service.ts",
        "apps/worker/src/git-transport.ts",
        "apps/preview/src/policy.ts",
        "apps/realtime/src/service.ts",
        "apps/web/src/app/actions.ts",
        "apps/web/src/app/api/health/route.ts",
        "apps/web/src/app/api/projects/**/route.ts",
        "apps/web/src/lib/{server,workbench,upload-stream,request-body}.ts",
        "apps/web/src/components/*.tsx",
      ],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 95,
        functions: 99,
        lines: 100,
        statements: 99,
      },
    },
    environment: "node",
    exclude: ["**/.next/**", "**/dist/**", "**/node_modules/**"],
    include: ["{apps,packages}/**/src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
