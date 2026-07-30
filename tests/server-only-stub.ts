/**
 * `server-only` throws on import outside a React Server Component. Under Vitest
 * there is no React runtime at all, so it is aliased to this no-op (see
 * vitest.config.ts). The guard still does its job in the application build.
 */
export {};
