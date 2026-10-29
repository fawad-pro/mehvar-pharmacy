#!/bin/sh
# Railway's pre-deploy command: migrate -> grants -> catalogue.
#
# A script rather than a `a && b && c` command line because Railway does not run
# the command through a shell: `&&` reached node as an argument, only migrate ran,
# the app role was never created and the health check failed. Any failing step
# stops the deploy (set -e).
set -eu
cd /srv
node app/bin/db/migrate.js
node app/bin/db/grants.js
node app/bin/catalog/import-pack.js catalog/starter.json --origin cloud --trusted-local
