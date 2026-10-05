import { main } from "./cli/main.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: Error) => {
    process.stderr.write(`css2lottie: ${err.message}\n`);
    process.exitCode = 1;
  },
);
