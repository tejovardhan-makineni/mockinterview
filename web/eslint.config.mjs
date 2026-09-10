import next from "eslint-config-next";

// Next 16 ships a flat-config array directly from eslint-config-next.
const eslintConfig = [
  ...next,
  { ignores: [".next/**", "out/**", "node_modules/**", "public/vendor/**"] },
];

export default eslintConfig;
