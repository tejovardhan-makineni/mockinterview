#!/usr/bin/env bash
# Pinned official standalone CLI for the Linux x64 deployment runner.
# Reviewed 2026-10-04. SHA-256 and size are GitHub's release asset metadata:
# https://api.github.com/repos/firebase/firebase-tools/releases/tags/v15.24.0
# Release: https://github.com/firebase/firebase-tools/releases/tag/v15.24.0
# Updates require reviewing that upstream release and changing all three pins.
# Run installation in the read-only build job. In the privileged job, use
# --verify after artifact download, then chmod +x; never resolve npm packages.
set -Eeuo pipefail
readonly FIREBASE_VERSION=15.24.0
readonly FIREBASE_SHA256=bf964987f095a5fb991cf1c709f640526a4e1b4f9eb1f271f5c09bc693263d33
readonly FIREBASE_BYTES=247631498
readonly FIREBASE_URL="https://github.com/firebase/firebase-tools/releases/download/v$FIREBASE_VERSION/firebase-tools-linux"

verify_only=false
if [[ "${1:-}" == --verify ]]; then verify_only=true; shift; fi
if [[ $# -gt 1 || "${1:-}" == -* ]]; then
  echo 'Usage: bash deploy/install-firebase-cli.sh [--verify] [DESTINATION]' >&2
  exit 1
fi
destination=${1:-deployment-inputs/firebase}

verify() {
  python3 - "$1" "$FIREBASE_SHA256" "$FIREBASE_BYTES" <<'PY'
import hashlib, os, stat, sys
filename, expected_hash, expected_size = sys.argv[1:]
try:
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != int(expected_size):
            raise ValueError("unexpected type or size")
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != expected_hash:
            raise ValueError("SHA-256 mismatch")
except (OSError, ValueError) as error:
    raise SystemExit("Firebase CLI verification failed: " + str(error))
PY
}

if [[ "$verify_only" == true ]]; then
  verify "$destination"
  echo "Verified official Firebase CLI $FIREBASE_VERSION Linux binary."
  exit 0
fi
if [[ -e "$destination" || -L "$destination" ]]; then
  echo 'Refusing to replace an existing destination; use --verify or a new path.' >&2
  exit 1
fi
mkdir -p -- "$(dirname -- "$destination")"
temporary=$(mktemp -d "$(dirname -- "$destination")/.firebase-cli.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
umask 077
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --retry 3 --retry-all-errors --connect-timeout 15 --max-time 300 \
  --max-filesize "$FIREBASE_BYTES" --output "$temporary/firebase" "$FIREBASE_URL"
verify "$temporary/firebase"
chmod 0755 "$temporary/firebase"
# Publish atomically without following or overwriting a destination introduced
# during download. The temporary file lives on the destination filesystem.
python3 - "$temporary/firebase" "$destination" <<'PY'
import os, sys
os.link(sys.argv[1], sys.argv[2], follow_symlinks=False)
PY
echo "Installed verified Firebase CLI $FIREBASE_VERSION Linux binary."
