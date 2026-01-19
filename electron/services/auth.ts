/**
 * Authentication Service for Electron Desktop App
 *
 * Provides full authentication functionality:
 * - User registration with email/password
 * - Sign in with email/password
 * - Sign out
 * - Session validation and management
 */

import { hash, compare } from "bcrypt-ts";
import { randomUUID } from "crypto";
import { sessionStore } from "./session-store";

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionData {
  user: LocalUser;
  expiresAt: Date;
  token: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  session?: SessionData;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface SignInData {
  email: string;
  password: string;
}

const SALT_ROUNDS = 10;

/**
 * ElectronAuthService
 * Full authentication service for desktop app
 */
export class ElectronAuthService {
  private static instance: ElectronAuthService;

  private constructor() {}

  static getInstance(): ElectronAuthService {
    if (!ElectronAuthService.instance) {
      ElectronAuthService.instance = new ElectronAuthService();
    }
    return ElectronAuthService.instance;
  }

  /**
   * Initialize the session store (call early in app startup)
   */
  async initialize(): Promise<void> {
    await sessionStore.initialize();
  }

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return hash(password, SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return compare(password, hashedPassword);
  }

  /**
   * Generate a secure session token
   */
  private generateSessionToken(): string {
    return `${randomUUID()}-${randomUUID()}`;
  }

  /**
   * Check if this is the first launch (no users with passwords)
   */
  async isFirstLaunch(): Promise<boolean> {
    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { isNotNull } = require("drizzle-orm");

      // Check if any user has a password set
      const [userWithPassword] = await db
        .select({ id: schema.UserTable.id })
        .from(schema.UserTable)
        .where(isNotNull(schema.UserTable.password))
        .limit(1);

      return !userWithPassword;
    } catch (error) {
      console.error("[Auth] Error checking first launch:", error);
      return true; // Assume first launch on error
    }
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      // Check if email already exists
      const [existingUser] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, data.email.toLowerCase()))
        .limit(1);

      if (existingUser && existingUser.password) {
        return {
          success: false,
          error: "An account with this email already exists",
        };
      }

      // Hash the password
      const hashedPassword = await this.hashPassword(data.password);

      let user;

      if (existingUser) {
        // Update existing user (e.g., old local@shadower.app user) with password
        [user] = await db
          .update(schema.UserTable)
          .set({
            name: data.name,
            email: data.email.toLowerCase(),
            password: hashedPassword,
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(schema.UserTable.id, existingUser.id))
          .returning();
      } else {
        // Create new user
        [user] = await db
          .insert(schema.UserTable)
          .values({
            name: data.name,
            email: data.email.toLowerCase(),
            password: hashedPassword,
            emailVerified: true,
            role: "admin", // First user is admin
            preferences: {
              displayName: data.name,
              botName: "Shadower",
            },
          })
          .returning();
      }

      if (!user) {
        return {
          success: false,
          error: "Failed to create user account",
        };
      }

      // Create session
      const sessionToken = this.generateSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store session in database
      await db.insert(schema.SessionTable).values({
        id: randomUUID(),
        token: sessionToken,
        userId: user.id,
        expiresAt: expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Store session token locally
      await sessionStore.setToken(sessionToken, user.id);

      console.log(`[Auth] User registered successfully: ${user.email}`);

      return {
        success: true,
        session: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name || data.name,
            image: user.image,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          expiresAt,
          token: sessionToken,
        },
      };
    } catch (error: any) {
      console.error("[Auth] Registration error:", error);
      return {
        success: false,
        error: error?.message || "Registration failed",
      };
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn(data: SignInData): Promise<AuthResult> {
    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      // Find user by email
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.email, data.email.toLowerCase()))
        .limit(1);

      if (!user) {
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      if (!user.password) {
        return {
          success: false,
          error: "This account doesn't have a password. Please register first.",
        };
      }

      // Check if user is banned
      if (user.banned) {
        return {
          success: false,
          error: user.banReason || "Your account has been suspended",
        };
      }

      // Verify password
      const isValid = await this.verifyPassword(data.password, user.password);

      if (!isValid) {
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Delete any existing sessions for this user (single session policy)
      await db
        .delete(schema.SessionTable)
        .where(eq(schema.SessionTable.userId, user.id));

      // Create new session
      const sessionToken = this.generateSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.insert(schema.SessionTable).values({
        id: randomUUID(),
        token: sessionToken,
        userId: user.id,
        expiresAt: expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Store session token locally
      await sessionStore.setToken(sessionToken, user.id);

      console.log(`[Auth] User signed in: ${user.email}`);

      return {
        success: true,
        session: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name || "User",
            image: user.image,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          expiresAt,
          token: sessionToken,
        },
      };
    } catch (error: any) {
      console.error("[Auth] Sign in error:", error);
      return {
        success: false,
        error: error?.message || "Sign in failed",
      };
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await sessionStore.getToken();
      const userId = await sessionStore.getUserId();

      if (token && userId) {
        const { getDatabase, schema } = require("./database");
        const db = getDatabase();
        const { eq } = require("drizzle-orm");

        // Delete session from database
        await db
          .delete(schema.SessionTable)
          .where(eq(schema.SessionTable.token, token));

        console.log(`[Auth] User signed out: ${userId}`);
      }

      // Clear local session
      await sessionStore.clearToken();

      return { success: true };
    } catch (error: any) {
      console.error("[Auth] Sign out error:", error);
      // Still clear local session even if database delete fails
      await sessionStore.clearToken();
      return { success: true };
    }
  }

  /**
   * Validate the current session
   */
  async validateSession(): Promise<SessionData | null> {
    try {
      const token = await sessionStore.getToken();
      const userId = await sessionStore.getUserId();

      if (!token || !userId) {
        return null;
      }

      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq, and, gt } = require("drizzle-orm");

      // Find valid session
      const [session] = await db
        .select()
        .from(schema.SessionTable)
        .where(
          and(
            eq(schema.SessionTable.token, token),
            eq(schema.SessionTable.userId, userId),
            gt(schema.SessionTable.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!session) {
        await sessionStore.clearToken();
        return null;
      }

      // Get user
      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.id, userId))
        .limit(1);

      if (!user) {
        await sessionStore.clearToken();
        return null;
      }

      // Check if user is banned
      if (user.banned) {
        await this.signOut();
        return null;
      }

      // Refresh session expiry on valid access
      await sessionStore.refreshExpiry();

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name || "User",
          image: user.image,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        expiresAt: session.expiresAt,
        token: token,
      };
    } catch (error) {
      console.error("[Auth] Session validation error:", error);
      return null;
    }
  }

  /**
   * Get current session (for backwards compatibility)
   * Returns session if authenticated, null otherwise
   */
  async getSession(): Promise<SessionData | null> {
    return this.validateSession();
  }

  /**
   * Get current user (requires valid session)
   */
  async getCurrentUser(): Promise<LocalUser | null> {
    const session = await this.validateSession();
    return session?.user || null;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const session = await this.validateSession();
    return session !== null;
  }

  /**
   * Update user profile
   */
  async updateProfile(data: {
    name?: string;
    image?: string | null;
  }): Promise<LocalUser | null> {
    const session = await this.validateSession();
    if (!session) {
      console.error("[Auth] Cannot update profile: not authenticated");
      return null;
    }

    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      const [updatedUser] = await db
        .update(schema.UserTable)
        .set({
          name: data.name !== undefined ? data.name : session.user.name,
          image: data.image !== undefined ? data.image : session.user.image,
          updatedAt: new Date(),
        })
        .where(eq(schema.UserTable.id, session.user.id))
        .returning();

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name || "User",
        image: updatedUser.image,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      };
    } catch (error) {
      console.error("[Auth] Error updating profile:", error);
      return null;
    }
  }

  /**
   * Get user preferences
   */
  async getPreferences(): Promise<any> {
    const session = await this.validateSession();
    if (!session) {
      return {};
    }

    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      const [user] = await db
        .select()
        .from(schema.UserTable)
        .where(eq(schema.UserTable.id, session.user.id))
        .limit(1);

      return user?.preferences || {};
    } catch (error) {
      console.error("[Auth] Error getting preferences:", error);
      return {};
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(preferences: any): Promise<void> {
    const session = await this.validateSession();
    if (!session) {
      console.error("[Auth] Cannot update preferences: not authenticated");
      return;
    }

    try {
      const { getDatabase, schema } = require("./database");
      const db = getDatabase();
      const { eq } = require("drizzle-orm");

      const currentPreferences = await this.getPreferences();

      await db
        .update(schema.UserTable)
        .set({
          preferences: {
            ...currentPreferences,
            ...preferences,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.UserTable.id, session.user.id));
    } catch (error) {
      console.error("[Auth] Error updating preferences:", error);
    }
  }
}

// Export default local user for backwards compatibility during migration
export const DEFAULT_LOCAL_USER = {
  id: "local-user",
  email: "local@shadower.app",
  name: "Local User",
  image: null,
} as const;
