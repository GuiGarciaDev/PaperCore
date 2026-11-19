import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const layerMessage = "Violação de camada (ver docs/adr/0002-camadas-e-fronteiras.md).";

export default defineConfig(
  { ignores: ["dist/**", "playground/dist/**", "node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/rendering/**", "**/interaction/**", "**/storage/**", "**/react/**", "**/engine*"],
              message: `O core não pode depender de outras camadas. ${layerMessage}`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/rendering/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/interaction/**", "**/storage/**", "**/react/**", "**/engine*"],
              message: `A renderização só pode depender do core. ${layerMessage}`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/storage/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/rendering/**", "**/interaction/**", "**/react/**", "**/engine*"],
              message: `O storage só pode depender do core. ${layerMessage}`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/react/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/core/**", "**/rendering/**", "**/interaction/**", "**/storage/**", "**/engine*"],
              message: `A camada React só usa a API pública (../index.js). ${layerMessage}`,
            },
          ],
        },
      ],
    },
  },
);
