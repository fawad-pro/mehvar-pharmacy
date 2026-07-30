/**
 * Test bootstrap. Loads `.env` so the integration suites can find a database;
 * suites that need one skip themselves when DATABASE_URL is absent, so
 * `npm test` stays runnable on a machine with no Postgres.
 */
import 'dotenv/config';
