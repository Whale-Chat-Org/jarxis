CREATE FUNCTION check_custom_role_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assigned_key text;
BEGIN
  FOR assigned_key IN SELECT btrim(value) FROM unnest(string_to_array(coalesce(NEW.role, ''), ',')) AS value LOOP
    IF left(assigned_key, 7) = 'custom_' THEN
      PERFORM 1 FROM custom_roles WHERE key = assigned_key FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown custom role' USING ERRCODE = '23503';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_user_custom_role_check
BEFORE INSERT OR UPDATE OF role ON app_user
FOR EACH ROW EXECUTE FUNCTION check_custom_role_assignment();

CREATE FUNCTION check_custom_role_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_user
    WHERE OLD.key = ANY(string_to_array(replace(coalesce(role, ''), ' ', ''), ','))
  ) THEN
    RAISE EXCEPTION 'Role is assigned to users' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER custom_role_delete_check
BEFORE DELETE ON custom_roles
FOR EACH ROW EXECUTE FUNCTION check_custom_role_delete();
