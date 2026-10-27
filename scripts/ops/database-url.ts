/**
 * Swap the database name in a connection URL, keeping credentials and host.
 *
 * Shared by `ops:restore-drill` and `ops:restore`, which both connect to
 * `postgres` to create, rename and drop databases, and then to the database
 * they made.
 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The database a connection URL points at. */
export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
