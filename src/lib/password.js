/**
 * The barangay's own minimum password length.
 *
 * Supabase Auth's floor is 6 characters; this is the stricter rule the system
 * applies on top of it. It lives here so the Add Admin form and the Change
 * Password form cannot drift apart and quietly enforce different rules.
 *
 * Passwords themselves are never held by this system. They go straight to
 * Supabase Auth, which stores only a hash; nothing here reads, keeps or logs
 * one.
 */
export const MIN_PASSWORD = 10
