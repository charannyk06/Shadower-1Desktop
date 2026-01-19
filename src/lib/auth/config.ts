import { AuthConfig, AuthConfigSchema } from "app-types/authentication";

/**
 * Get auth configuration
 * For Electron desktop app with local authentication
 */
export function getAuthConfig(): AuthConfig {
  const config = {
    emailAndPasswordEnabled: true, // Enable email/password for local auth
    signUpEnabled: true, // Enable sign-up for first-time users
    socialAuthenticationProviders: {}, // No OAuth in Electron desktop
  };

  // Validate and return config
  const result = AuthConfigSchema.safeParse(config);
  if (!result.success) {
    // Fallback to default config if validation fails
    return {
      emailAndPasswordEnabled: true,
      signUpEnabled: true,
      socialAuthenticationProviders: {},
    };
  }

  return result.data;
}
