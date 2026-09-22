import { parseQuery } from './lib/query.js';
import { isValidName } from './lib/validate.js';

// CLI_WIRE keep signature: run(argv)
export function run(argv) {
  const q = parseQuery(argv[0] ?? '');
  return { query: q, nameOk: isValidName(argv[1] ?? '') };
}
