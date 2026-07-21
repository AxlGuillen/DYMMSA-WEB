import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefactos generados de cobertura (vitest --coverage) — no son código nuestro.
    "coverage/**",
    // Scripts one-shot históricos (Fase 0) — archivados, no se mantienen.
    "scripts/archive/**",
  ]),
  {
    rules: {
      // Prefijo `_` = "intencionalmente sin usar" (params que documentan una
      // firma pública, destructuring parcial). Mantiene el lint en cero sin
      // borrar parámetros con valor documental.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
