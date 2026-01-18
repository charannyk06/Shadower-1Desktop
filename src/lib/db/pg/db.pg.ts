// import { Logger } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

// class MyLogger implements Logger {
//   logQuery(query: string, params: unknown[]): void {
//     console.log({ query, params });
//   }
// }

const getDatabaseUrl = () => {
  // Support both POSTGRES_URL and DATABASE_URL for compatibility
  // DATABASE_URL is commonly used in Vercel Preview/Development environments
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "\x1b[31m[DATABASE ERROR]\x1b[0m Neither POSTGRES_URL nor DATABASE_URL environment variable is set.\n" +
        "Please set POSTGRES_URL or DATABASE_URL in your .env file. Example:\n" +
        "POSTGRES_URL=postgres://your_username:your_password@localhost:5432/your_database_name\n\n" +
        "To start PostgreSQL locally, run: pnpm docker:pg",
    );
    throw new Error(
      "Database URL is not configured. Check server logs for setup instructions.",
    );
  }
  return url;
};

/**
 * Get the unpooled database URL for operations requiring transactions with row-level locking.
 * Neon's connection pooler (PgBouncer) in transaction mode doesn't properly support
 * SELECT ... FOR UPDATE because queries may be routed to different backend connections.
 * For these operations, we need a direct (unpooled) connection.
 */
const getUnpooledDatabaseUrl = () => {
  // Prefer DATABASE_URL_UNPOOLED if available, fall back to POSTGRES_URL or DATABASE_URL
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither DATABASE_URL_UNPOOLED, POSTGRES_URL, nor DATABASE_URL is configured.",
    );
  }
  return url;
};

export const pgDb = drizzlePg(getDatabaseUrl(), {
  //   logger: new MyLogger(),
});

/**
 * Database connection for operations that require transactions with row-level locking
 * (e.g., SELECT ... FOR UPDATE). Uses unpooled connection to ensure all queries
 * in a transaction execute on the same backend connection.
 */
export const pgDbUnpooled = drizzlePg(getUnpooledDatabaseUrl(), {
  //   logger: new MyLogger(),
});
