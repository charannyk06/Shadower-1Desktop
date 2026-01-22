/**
 * Test user constants for Playwright E2E tests.
 * These are used for authentication during testing.
 */

interface TestUser {
  email: string;
  password: string;
  authFile: string;
}

interface TestUsers {
  admin: TestUser;
  editor: TestUser;
  editor2: TestUser;
  regular: TestUser;
}

/**
 * Test users for E2E testing.
 * In Electron mode (single-user), these are still used for Playwright test structure
 * but authentication is simplified.
 */
export const TEST_USERS: TestUsers = {
  admin: {
    email: process.env.TEST_ADMIN_EMAIL || "admin@test.local",
    password: process.env.TEST_ADMIN_PASSWORD || "testpassword",
    authFile: ".auth/admin.json",
  },
  editor: {
    email: process.env.TEST_EDITOR_EMAIL || "editor@test.local",
    password: process.env.TEST_EDITOR_PASSWORD || "testpassword",
    authFile: ".auth/editor.json",
  },
  editor2: {
    email: process.env.TEST_EDITOR2_EMAIL || "editor2@test.local",
    password: process.env.TEST_EDITOR2_PASSWORD || "testpassword",
    authFile: ".auth/editor2.json",
  },
  regular: {
    email: process.env.TEST_REGULAR_EMAIL || "user@test.local",
    password: process.env.TEST_REGULAR_PASSWORD || "testpassword",
    authFile: ".auth/regular.json",
  },
};
