import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const layerMessage = "Layer violation (see 'Architecture' in README.md).";

export default defineConfig(
  { ignores: ["dist/**", "playground/dist/**", "node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    // Node scripts (media generator).
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly" } },
  },
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
              message: `The core cannot depend on other layers. ${layerMessage}`,
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
              message: `Rendering may only depend on the core. ${layerMessage}`,
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
              message: `Storage may only depend on the core. ${layerMessage}`,
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
              message: `The React layer only uses the public API (../index.js). ${layerMessage}`,
            },
          ],
        },
      ],
    },
  },
);
