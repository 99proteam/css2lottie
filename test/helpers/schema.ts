import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
// The official Lottie specification schema (lottie.github.io/lottie-spec), via its JS bindings.
const { LottieValidator, get_schema_path } =
  require("@lottie-animation-community/lottie-specs/src/validator-node.js") as {
    LottieValidator: new (
      ajv: unknown,
      schema: unknown,
      config?: unknown,
    ) => {
      validate(
        data: unknown,
        warnings?: boolean,
      ): Array<{ type: string; message: string; path?: string; instancePath?: string }>;
    };
    get_schema_path(): string;
  };

let validator: InstanceType<typeof LottieValidator> | null = null;

/** Validate against the Lottie spec JSON schema; returns error messages (empty = valid). */
export function validateLottie(data: unknown): string[] {
  if (!validator) {
    const schema = JSON.parse(readFileSync(get_schema_path(), "utf8"));
    const Ajv = (Ajv2020 as unknown as { default?: unknown }).default ?? Ajv2020;
    validator = new LottieValidator(Ajv, schema, { name_paths: true });
  }
  return validator
    .validate(data, false)
    .filter((e) => e.type === "error")
    .map((e) => `${e.path ?? e.instancePath ?? ""}: ${e.message}`);
}
