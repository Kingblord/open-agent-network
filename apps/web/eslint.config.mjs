import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core";

export default defineConfig([
  ...globalIgnores,
  next,
  {
    ignores: {
      files: ["**/.next/**", "**/next-env.d.ts"],
    },
  },
]);