import { colorize } from "consola/utils";
import "load-env";

// This is a local-first Electron desktop app using SQLite
// Test users are created automatically during E2E test setup via Playwright fixtures
// No manual seeding required

console.info(
  colorize("green", "Local-first desktop app - SQLite handles user creation"),
);
console.info(
  "Test users will be created automatically during Playwright test setup",
);

process.exit(0);
