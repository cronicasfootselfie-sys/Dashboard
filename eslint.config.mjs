import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Config básica de Next + TypeScript
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Reglas globales adicionales
  {
    rules: {
      // Evita el error de las comillas en JSX
      "react/no-unescaped-entities": "off",
    },
  },

  // Reglas específicas para un archivo
  {
    files: ["src/lib/redcapFirestore.ts"],
    rules: {
      // Evita el error de "Unexpected any"
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
