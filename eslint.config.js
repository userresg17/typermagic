// Typer Code — ESLint flat config (v9)
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "app/editor/**",
      "app/server/bin/**",
      "frontend/**",
      "ui/**",
      // casca/extensão do editor: contexto browser/VS Code (DOM) e artefatos de
      // build, fora do escopo Node do núcleo. Os scripts editor/*.mjs seguem linted.
      "editor/workbench/**",
      "editor/extensions/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // projeto Node em todas as camadas (CLI, núcleo, scripts)
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
);
