import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Config base de Next + TypeScript
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // 👇 Aquí añades tus reglas personalizadas
  {
    rules: {
      // No rompas por comillas sin escapar en JSX
      "react/no-unescaped-entities": "off",

      // No rompas por uso de "any"
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
