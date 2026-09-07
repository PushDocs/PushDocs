import { closeDatabase, getDatabase, PushDocsRepository } from "@pushdocs/db";
import { createWorkerService } from "./service";

const repository = new PushDocsRepository(getDatabase());
const worker = createWorkerService({ repository });
let stopping = false;
let nextReviewSyncAt = 0;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function main(): Promise<void> {
  console.log("PushDocs worker started");
  while (!stopping) {
    const worked = await worker.runJob();
    if (Date.now() >= nextReviewSyncAt) {
      nextReviewSyncAt = Date.now() + 30_000;
      await worker.synchronizeActiveReviews();
    }
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

try {
  await main();
} finally {
  await closeDatabase();
}
