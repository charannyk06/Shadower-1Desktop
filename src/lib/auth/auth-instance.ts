import { DEFAULT_USER_ROLE, USER_ROLES } from "app-types/roles";
// Base auth instance without "server-only" - can be used in seed scripts
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
import { pgDb } from "lib/db/pg/db.pg";
import {
  AccountTable,
  SessionTable,
  UserTable,
  VerificationTable,
} from "lib/db/pg/schema.pg";
import { userRepository } from "lib/db/repository";
import logger from "logger";
import { headers } from "next/headers";
import { getAuthConfig } from "./config";
import { ac, admin, editor, user } from "./roles";

const getAuthSecret = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === "****") {
    console.error(
      "\x1b[31m[AUTH ERROR]\x1b[0m BETTER_AUTH_SECRET environment variable is not set or invalid.\n" +
        "Please set a secure secret in your .env file.\n" +
        "Generate one with: npx @better-auth/cli@latest secret",
    );
    throw new Error(
      "BETTER_AUTH_SECRET is not configured. Check server logs for setup instructions.",
    );
  }
  return secret;
};

const {
  emailAndPasswordEnabled,
  signUpEnabled,
  socialAuthenticationProviders,
} = getAuthConfig();

// Get the base URL for OAuth callbacks - this MUST match the production URL exactly
const getBaseURL = () => {
  const url = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!url) {
    console.warn(
      "\x1b[33m[AUTH WARNING]\x1b[0m BETTER_AUTH_URL is not set. OAuth may fail with state_mismatch error.\n" +
        "Set BETTER_AUTH_URL to your production URL (e.g., https://yourdomain.com)",
    );
  }
  return url;
};

const options = {
  secret: getAuthSecret(),
  plugins: [
    adminPlugin({
      defaultRole: DEFAULT_USER_ROLE,
      adminRoles: [USER_ROLES.ADMIN],
      ac,
      roles: {
        admin,
        editor,
        user,
      },
    }),
    nextCookies(),
  ],
  baseURL: getBaseURL(),
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
  },
  database: drizzleAdapter(pgDb, {
    provider: "pg",
    schema: {
      user: UserTable,
      session: SessionTable,
      account: AccountTable,
      verification: VerificationTable,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // This hook ONLY runs during user creation (sign-up), not on sign-in
          // Use our optimized getIsFirstUser function with caching
          const isFirstUser = await getIsFirstUser();

          // Set role based on whether this is the first user
          const role = isFirstUser ? USER_ROLES.ADMIN : DEFAULT_USER_ROLE;

          logger.info(
            `User creation hook: ${user.email} will get role: ${role} (isFirstUser: ${isFirstUser})`,
          );

          return {
            data: {
              ...user,
              role,
            },
          };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: emailAndPasswordEnabled,
    disableSignUp: !signUpEnabled,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60,
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
  },
  advanced: {
    useSecureCookies:
      process.env.NO_HTTPS == "1"
        ? false
        : process.env.NODE_ENV === "production",
    // Enable cross-site cookies for OAuth flow - required for state parameter to work
    // when redirecting back from OAuth providers (Google, GitHub, Microsoft)
    crossSubDomainCookies: {
      enabled: Boolean(process.env.COOKIE_DOMAIN),
      domain: process.env.COOKIE_DOMAIN, // e.g., ".example.com" for subdomains
    },
    // Default cookie attributes for OAuth state cookies
    defaultCookieAttributes: {
      sameSite: "lax", // Required for OAuth redirects to work
      path: "/",
    },
    database: {
      generateId: false,
    },
  },
  account: {
    accountLinking: {
      trustedProviders: (
        Object.keys(
          socialAuthenticationProviders,
        ) as (keyof typeof socialAuthenticationProviders)[]
      ).filter((key) => socialAuthenticationProviders[key]),
    },
  },
  socialProviders: socialAuthenticationProviders,
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [...(options.plugins ?? [])],
});

export const getSession = async () => {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session) {
      logger.error("No session found");
      return null;
    }
    return session;
  } catch (error) {
    logger.error("Error getting session:", error);
    return null;
  }
};

// Cache the first user check to avoid repeated DB queries
let isFirstUserCache: boolean | null = null;

export const getIsFirstUser = async () => {
  // If we already know there's at least one user, return false immediately
  // This in-memory cache prevents any DB calls once we know users exist
  if (isFirstUserCache === false) {
    return false;
  }

  try {
    // Direct database query - simple and reliable
    const userCount = await userRepository.getUserCount();
    const isFirstUser = userCount === 0;

    // Once we have at least one user, cache it permanently in memory
    if (!isFirstUser) {
      isFirstUserCache = false;
    }

    return isFirstUser;
  } catch (error) {
    logger.error("Error checking if first user:", error);
    // Cache as false on error to prevent repeated attempts
    isFirstUserCache = false;
    return false;
  }
};
