import { closeDatabase, getDatabase, PushDocsRepository } from "@pushdocs/db";
import { createPreviewService } from "./service";

const preview = createPreviewService({ repository: new PushDocsRepository(getDatabase()) });
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });

try {
  console.log("PushDocs preview runner started");
  while (!stopping) {
    try {
      await preview.tick();
    } catch (error) {
      console.error(`Preview reconciliation failed: ${String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} finally {
  await preview.stopAll();
  await closeDatabase();
}
