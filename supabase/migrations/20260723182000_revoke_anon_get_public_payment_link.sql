/*
 * Revoke EXECUTE permission on public.get_public_payment_link from anon and authenticated roles.
 * Resolves Supabase Linter warnings:
 * - anon_security_definer_function_executable
 * - authenticated_security_definer_function_executable
 *
 * SubScript routes execute all RPCs via service_role or direct PG connection.
 */

REVOKE EXECUTE ON FUNCTION public.get_public_payment_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_payment_link(uuid) TO service_role, postgres;
