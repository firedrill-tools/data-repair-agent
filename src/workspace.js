import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { initialize, inspect, listCases, reset } from "./datasets.js";
export function main(args = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { case: { type: "string" }, help: { type: "boolean" } },
    });
    if (values.help) {
      console.log(
        "data-workspace list | init ROOT [--case CASE] | inspect ROOT | reset OLD_ROOT NEW_ROOT",
      );
      return;
    }
    const [command, root, destination] = positionals;
    let result;
    if (command === "list" && positionals.length === 1 && !values.case)
      result = { cases: listCases() };
    else if (command === "init" && positionals.length === 2)
      result = initialize(root, values.case);
    else if (command === "inspect" && positionals.length === 2 && !values.case)
      result = inspect(root);
    else if (command === "reset" && positionals.length === 3 && !values.case)
      result = reset(root, destination);
    else
      throw Error(
        "use list, init ROOT [--case CASE], inspect ROOT or reset OLD_ROOT NEW_ROOT",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
