// NOTE: eslint is intentionally pinned to 9 in package.json, not ^10.
//
// ESLint 10 removed context.getFilename(), which eslint-plugin-react still
// calls (lib/util/version.js resolveBasedir). eslint-config-next depends on
// that plugin, so `eslint .` dies with:
//   TypeError: Error while loading rule 'react/display-name':
//   contextOrFilename.getFilename is not a function
//
// eslint-plugin-react 7.37.5 is the latest release and its peer range is
// `eslint ^3 || ... || ^9.7` -- there is no ESLint 10 support to upgrade to.
// Revisit once eslint-plugin-react ships an ESLint 10 compatible release.
// (This bump was attempted and reverted twice: e91f245 and 2026-10.)
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: ["node_modules/**", ".next/**", "jest.config.js", "jest.integration.config.js", "lib/db/schema.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // The privileged (secret-key) Supabase client bypasses RLS. Only the auth
    // services may create it, and only after an authorization check.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["lib/services/auth/**", "lib/supabase/privileged.ts", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/supabase/privileged", "**/supabase/privileged"],
              message:
                "Use the authorize* functions in lib/services/auth to obtain a PrivilegedClient.",
            },
          ],
        },
      ],
    },
  },
  {
    // The direct Postgres connection (lib/db/client) also bypasses RLS. Services get
    // it from the authorize* functions as `pg`; repositories receive an Executor.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["lib/services/auth/**", "lib/db/**", "integration/**", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/supabase/privileged", "**/supabase/privileged"],
              message:
                "Use the authorize* functions in lib/services/auth to obtain a PrivilegedClient.",
            },
            {
              group: ["@/lib/db/client", "**/db/client"],
              message:
                "Use the authorize* functions in lib/services/auth to obtain a Db (`pg`); import types from lib/db/tx.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
