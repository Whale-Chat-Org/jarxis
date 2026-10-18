-- Immutable normalization matches role-keys.ts, including ECMAScript trim whitespace.
-- No stored role assignments, credentials, or physical provider table names change.
CREATE FUNCTION normalized_role_keys(stored text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
 FROM (
   SELECT btrim(value, E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') AS key
   FROM unnest(string_to_array(coalesce(stored, ''), ',')) AS value
 ) normalized WHERE key <> '';
$$;
CREATE OR REPLACE FUNCTION check_custom_role_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assigned_key text;
BEGIN
 FOR assigned_key IN SELECT unnest(normalized_role_keys(NEW.role)) LOOP
   IF left(assigned_key, 7) = 'custom_' THEN
     PERFORM 1 FROM roles WHERE key = assigned_key FOR KEY SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Unknown custom role' USING ERRCODE = '23503'; END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION check_custom_role_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.system THEN RAISE EXCEPTION 'System roles cannot be deleted' USING ERRCODE = '23503'; END IF;
 IF EXISTS (SELECT 1 FROM app_user WHERE OLD.key = ANY(normalized_role_keys(role))) THEN
   RAISE EXCEPTION 'Role is assigned to users' USING ERRCODE = '23503';
 END IF;
 RETURN OLD;
END;
$$;
ALTER TABLE ml_connections DROP CONSTRAINT ml_connections_provider_check;
ALTER TABLE ml_connections ADD CONSTRAINT ml_connections_provider_check CHECK (provider IN ('openai', 'anthropic', 'openrouter', 'custom'));
