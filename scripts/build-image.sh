#!/usr/bin/env bash
set -euo pipefail

ALPINE_VERSION="${ALPINE_VERSION:-3.24.1}"
IMAGE_SIZE="${IMAGE_SIZE:-24M}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT:-$ROOT_DIR/public/webshell.ext2}"
WORK="$(mktemp -d)"
ROOTFS="$WORK/rootfs"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

for command in curl tar sha256sum mke2fs; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "error: missing required command: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOTFS" "$(dirname "$OUT")"

ALPINE_FILE="alpine-minirootfs-${ALPINE_VERSION}-x86.tar.gz"
ALPINE_BRANCH="v${ALPINE_VERSION%.*}"
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}/releases/x86/${ALPINE_FILE}"

printf '==> Downloading Alpine %s (x86)\n' "$ALPINE_VERSION"
curl --fail --location --retry 3 --output "$WORK/$ALPINE_FILE" "$ALPINE_URL"
curl --fail --location --retry 3 --output "$WORK/$ALPINE_FILE.sha256" "$ALPINE_URL.sha256"
(
  cd "$WORK"
  sha256sum -c "$ALPINE_FILE.sha256"
)

echo '==> Extracting Alpine minirootfs'
tar --extract --gzip --numeric-owner --file "$WORK/$ALPINE_FILE" --directory "$ROOTFS"

printf 'Riyo-WebShell\n' > "$ROOTFS/etc/hostname"

cat > "$ROOTFS/etc/resolv.conf" <<'EOF_RESOLV'
nameserver 8.8.8.8
nameserver 8.8.4.4
options timeout:2 attempts:3
EOF_RESOLV

cat > "$ROOTFS/etc/webshell-release" <<EOF_RELEASE
ALPINE_VERSION=${ALPINE_VERSION}
ARCH=x86
EOF_RELEASE

# Keep the image intentionally minimal: no package installation is performed.
# Browser-side writes are stored in the CheerpX IndexedDB overlay.
rm -f "$OUT"
echo "==> Creating $IMAGE_SIZE ext2 image"
mke2fs -q -t ext2 -b 4096 -d "$ROOTFS" -L webshell "$OUT" "$IMAGE_SIZE"

IMAGE_SHA256="$(sha256sum "$OUT" | awk '{print $1}')"
printf '==> Built %s (%s, sha256 %s)\n' "$OUT" "$(du -h "$OUT" | awk '{print $1}')" "$IMAGE_SHA256"
