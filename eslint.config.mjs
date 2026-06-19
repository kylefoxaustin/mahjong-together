import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // The coach's spoken copy is full of natural apostrophes and quotes
      // ("you don't", "the 3 Bam"). Escaping them as &apos;/&quot; would hurt
      // source readability for zero runtime benefit, so allow them as-is.
      "react/no-unescaped-entities": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Archival reference artifacts (the v0.2 source + CampMatch's files) —
    // not project source, kept only for provenance.
    "reference/**",
  ]),
]);

export default eslintConfig;
