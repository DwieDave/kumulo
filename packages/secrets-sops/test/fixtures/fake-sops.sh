#!/bin/sh
# ponytail: fixture-only stand-in for the real `sops` binary — records the
# argv it was invoked with and the plaintext piped to its stdin, then emits
# a deterministic (fake) ciphertext to stdout so the sink test can assert on
# all three without a real sops binary or age key.
printf '%s\n' "$*" > "$SOPS_CAPTURE_DIR/args"
cat > "$SOPS_CAPTURE_DIR/stdin"
printf 'ENCRYPTED\n'
cat "$SOPS_CAPTURE_DIR/stdin"
