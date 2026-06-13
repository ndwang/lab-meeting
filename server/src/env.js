// Required environment lookup. Fails fast — never returns a default fallback.
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
