# Sourced inside the container: password file and archive key go to tmpfs only.
set -euo pipefail
if [ -n "${CB_KEY:-}" ]; then printf '%s' "$CB_KEY" >/dev/shm/k; chmod 600 /dev/shm/k; unset CB_KEY; fi
gpgk() { gpg --batch --quiet --pinentry-mode loopback --passphrase-file /dev/shm/k "$@"; }
