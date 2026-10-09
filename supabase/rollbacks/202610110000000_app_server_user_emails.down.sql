-- Emergency rollback for 202610110000000_app_server_user_emails.sql.

DROP VIEW IF EXISTS app_private.user_emails;
DROP SCHEMA IF EXISTS app_private;
