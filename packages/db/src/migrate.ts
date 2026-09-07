import { createDatabase } from "./database";
import { migrateToLatest } from "./migrations";

const database = createDatabase();
try {
  await migrateToLatest(database);
} finally {
  await database.destroy();
}
