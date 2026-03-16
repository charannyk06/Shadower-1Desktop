import { describe, expect, it, vi } from "vitest";
import { getAuthConfig } from "./config";

// Mock experimental_taintUniqueValue since it's not available in test environment
vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    experimental_taintUniqueValue: vi.fn(),
  };
});

describe("Auth Config", () => {
  describe("getAuthConfig", () => {
    it("should return default config for Electron desktop app", () => {
      const config = getAuthConfig();

      expect(config).toEqual({
        emailAndPasswordEnabled: true,
        signUpEnabled: true,
        socialAuthenticationProviders: {},
      });
    });

    it("should have email and password enabled", () => {
      const config = getAuthConfig();
      expect(config.emailAndPasswordEnabled).toBe(true);
    });

    it("should have sign-up enabled", () => {
      const config = getAuthConfig();
      expect(config.signUpEnabled).toBe(true);
    });

    it("should have no social auth providers (desktop app)", () => {
      const config = getAuthConfig();
      expect(config.socialAuthenticationProviders).toEqual({});
    });

    it("should return consistent config on multiple calls", () => {
      const config1 = getAuthConfig();
      const config2 = getAuthConfig();
      expect(config1).toEqual(config2);
    });
  });
});
