/**
 * Simplified authentication service for Electron desktop app
 *
 * Unlike the web version with OAuth providers, the desktop app:
 * - Uses a single local user (no multi-user support)
 * - No authentication flow required
 * - LLM API keys stored in user preferences
 */

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionData {
  user: LocalUser;
  expiresAt: Date;
}

/**
 * Default local user for Electron app
 * This user is automatically created on first launch
 */
export const DEFAULT_LOCAL_USER = {
  id: "local-user",
  email: "local@shadower.app",
  name: "Local User",
  image: null,
  role: "admin",
} as const;

/**
 * ElectronAuthService
 * Simple auth service for desktop app that always returns the local user
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
   * Get current session (always returns local user)
   */
  async getSession(): Promise<SessionData> {
    // Import database here to avoid circular dependencies
    const { getDatabase, schema } = require("./database");
    const db = getDatabase();
    const { eq } = require("drizzle-orm");

    // Get the local user from database
    const [user] = await db
      .select()
      .from(schema.UserTable)
      .where(eq(schema.UserTable.email, DEFAULT_LOCAL_USER.email))
      .limit(1);

    if (!user) {
      throw new Error("Local user not found. Database may not be initialized.");
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name || DEFAULT_LOCAL_USER.name,
        image: user.image,
        role: user.role || DEFAULT_LOCAL_USER.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      // Session never expires for local user
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    };
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<LocalUser> {
    const session = await this.getSession();
    return session.user;
  }

  /**
   * Check if user is authenticated (always true for desktop app)
   */
  isAuthenticated(): boolean {
    return true;
  }

  /**
   * Update user profile
   */
  async updateProfile(data: {
    name?: string;
    image?: string | null;
  }): Promise<LocalUser> {
    const { getDatabase, schema } = require("./database");
    const db = getDatabase();
    const { eq } = require("drizzle-orm");

    // Get current user
    const currentUser = await this.getCurrentUser();

    // Update user in database
    const [updatedUser] = await db
      .update(schema.UserTable)
      .set({
        name: data.name !== undefined ? data.name : currentUser.name,
        image: data.image !== undefined ? data.image : currentUser.image,
        updatedAt: new Date(),
      })
      .where(eq(schema.UserTable.id, currentUser.id))
      .returning();

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name || DEFAULT_LOCAL_USER.name,
      image: updatedUser.image,
      role: updatedUser.role || DEFAULT_LOCAL_USER.role,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    };
  }

  /**
   * Get user preferences (includes LLM API keys)
   */
  async getPreferences(): Promise<any> {
    const { getDatabase, schema } = require("./database");
    const db = getDatabase();
    const { eq } = require("drizzle-orm");

    const [user] = await db
      .select()
      .from(schema.UserTable)
      .where(eq(schema.UserTable.email, DEFAULT_LOCAL_USER.email))
      .limit(1);

    return user?.preferences || {};
  }

  /**
   * Update user preferences (for storing LLM API keys, etc.)
   */
  async updatePreferences(preferences: any): Promise<void> {
    const { getDatabase, schema } = require("./database");
    const db = getDatabase();
    const { eq } = require("drizzle-orm");

    const currentUser = await this.getCurrentUser();
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
      .where(eq(schema.UserTable.id, currentUser.id));
  }
}
