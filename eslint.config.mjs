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
    ignores: ["node_modules/**", ".next/**", "jest.config.js"],
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
];

export default eslintConfig;
