import 'dotenv/config';

import { refusalFor } from '../../e2e/support/database-guard';

// Run before `e2e:reset` wipes anything: the check belongs ahead of the reset.
const refusal = refusalFor(process.env);
if (refusal !== null) {
  console.error(refusal);
  process.exit(1);
}
