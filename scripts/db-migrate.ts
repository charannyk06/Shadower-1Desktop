import { colorize } from "consola/utils";
import "load-env";

// This is a local-first Electron desktop app using SQLite only
// PostgreSQL migrations are no longer needed

console.info(
  colorize("green", "🏠 Local-first desktop app - using SQLite database"),
);
console.info(
  "📦 SQLite database will be initialized automatically on first run",
);
console.info(
  "✅ No manual migration needed for SQLite (Drizzle handles schema sync)",
);

process.exit(0);
