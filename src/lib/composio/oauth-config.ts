// Shared OAuth setup links for Composio integrations
export const OAUTH_SETUP_LINKS: Record<
  string,
  { url: string; instructions: string }
> = {
  jira: {
    url: "https://developer.atlassian.com/console/myapps/",
    instructions:
      "1. Go to Atlassian Developer Console\n2. Create a new OAuth 2.0 app\n3. Add redirect URL: https://backend.composio.dev/api/v1/auth-apps/add\n4. Copy Client ID and Client Secret",
  },
  salesforce: {
    url: "https://login.salesforce.com/",
    instructions:
      "1. Go to Setup > App Manager\n2. Create a new Connected App\n3. Enable OAuth Settings\n4. Add redirect URL: https://backend.composio.dev/api/v1/auth-apps/add\n5. Copy Consumer Key and Consumer Secret",
  },
  zendesk: {
    url: "https://developer.zendesk.com/",
    instructions:
      "1. Go to Zendesk Admin Center\n2. Navigate to Apps and Integrations > APIs > Zendesk API\n3. Create OAuth Client\n4. Add redirect URL: https://backend.composio.dev/api/v1/auth-apps/add\n5. Copy Client ID and Client Secret",
  },
  default: {
    url: "",
    instructions:
      "1. Go to the app's developer portal\n2. Create a new OAuth 2.0 application\n3. Add redirect URL: https://backend.composio.dev/api/v1/auth-apps/add\n4. Copy Client ID and Client Secret\n5. Configure required scopes",
  },
};

export const COMPOSIO_REDIRECT_URL =
  "https://backend.composio.dev/api/v1/auth-apps/add";

/**
 * Get OAuth setup info for a specific app
 */
export function getOAuthSetupInfo(appName: string) {
  return OAUTH_SETUP_LINKS[appName] || OAUTH_SETUP_LINKS.default;
}
