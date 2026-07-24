#!/bin/sh
# ponytail: fixture-only — simulates sops refusing to encrypt (e.g. no
# matching creation rule / bad recipient) so the sink's non-zero-exit path
# is exercised without a real failure mode.
echo "sops: no matching creation rules found" >&2
exit 1
