-- 1. Append-only audit log, enforced by the database.
-- Until now "never UPDATE/DELETE claim_events" was only a convention.
-- A trigger turns it into a guarantee: even a buggy service or a person
-- in psql gets an error. (Revoking privileges from the app role is the
-- other option, but the local Docker setup and Supabase both connect as
-- the table owner, which REVOKE cannot restrict. A trigger works for everyone.)
CREATE OR REPLACE FUNCTION claim_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'claim_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER claim_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "claim_events"
  FOR EACH ROW EXECUTE FUNCTION claim_events_append_only();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER claim_events_no_truncate
  BEFORE TRUNCATE ON "claim_events"
  FOR EACH STATEMENT EXECUTE FUNCTION claim_events_append_only();
--> statement-breakpoint
-- 2. Mirror Supabase auth.users -> public.users (role 'customer').
-- This trigger used to exist only in the Supabase dashboard, so a fresh
-- DB broke signup with a 23503 FK violation. It now lives in the repo.
-- It is guarded because local Docker Postgres has no "auth" schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      BEGIN
        INSERT INTO public.users (id, email, role)
        VALUES (NEW.id, NEW.email, 'customer')
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END;
      $body$;
    $fn$;
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
             FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()';
    -- Backfill anyone who signed up before the trigger existed.
    EXECUTE 'INSERT INTO public.users (id, email, role)
             SELECT id, email, ''customer'' FROM auth.users
             ON CONFLICT (id) DO NOTHING';
  END IF;
END
$$;
