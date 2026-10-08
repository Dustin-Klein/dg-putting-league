-- Emergency rollback for 202610080000000_app_server_role.sql.
-- Run only after the app no longer connects as app_server (DATABASE_URL unset or
-- pointing at another role), otherwise every server write fails.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM app_server;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_server;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_server;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_server;
REVOKE USAGE ON SCHEMA public FROM app_server;

DROP ROLE IF EXISTS app_server;
