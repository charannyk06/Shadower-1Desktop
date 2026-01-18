import { ipcMain } from 'electron';
import { getDatabase, schema } from '../services/database';
import { eq } from 'drizzle-orm';

export function registerUserHandlers() {
  const db = getDatabase();

  // Get user preferences
  ipcMain.handle('db:user:getPreferences', async () => {
    try {
      // Get the default local user
      const user = await db.query.UserTable.findFirst({
        where: eq(schema.UserTable.email, 'local@shadower.app'),
      });

      return user?.preferences || {};
    } catch (error) {
      console.error('[IPC] Error getting user preferences:', error);
      throw error;
    }
  });

  // Update user preferences
  ipcMain.handle('db:user:updatePreferences', async (event, data: any) => {
    try {
      // Get the default local user
      const user = await db.query.UserTable.findFirst({
        where: eq(schema.UserTable.email, 'local@shadower.app'),
      });

      if (!user) {
        throw new Error('Default user not found');
      }

      await db
        .update(schema.UserTable)
        .set({
          preferences: {
            ...user.preferences,
            ...data,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.UserTable.id, user.id));

      return { success: true };
    } catch (error) {
      console.error('[IPC] Error updating user preferences:', error);
      throw error;
    }
  });

  // Get current user
  ipcMain.handle('db:user:getCurrent', async () => {
    try {
      const user = await db.query.UserTable.findFirst({
        where: eq(schema.UserTable.email, 'local@shadower.app'),
      });

      return user;
    } catch (error) {
      console.error('[IPC] Error getting current user:', error);
      throw error;
    }
  });

  // Update user profile
  ipcMain.handle('db:user:updateProfile', async (event, data: any) => {
    try {
      const user = await db.query.UserTable.findFirst({
        where: eq(schema.UserTable.email, 'local@shadower.app'),
      });

      if (!user) {
        throw new Error('Default user not found');
      }

      const [updatedUser] = await db
        .update(schema.UserTable)
        .set({
          name: data.name || user.name,
          image: data.image !== undefined ? data.image : user.image,
          updatedAt: new Date(),
        })
        .where(eq(schema.UserTable.id, user.id))
        .returning();

      return updatedUser;
    } catch (error) {
      console.error('[IPC] Error updating user profile:', error);
      throw error;
    }
  });

  console.log('[IPC] User handlers registered');
}
