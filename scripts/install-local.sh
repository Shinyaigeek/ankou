#!/bin/sh
# Put `kamu` on PATH from this checkout: build once, then symlink the launcher.
#
#   ./scripts/install-local.sh              # → ~/.local/bin/kamu
#   BIN_DIR=/usr/local/bin ./scripts/...    # somewhere else
#   SKIP_BUILD=1 ./scripts/install-local.sh # already built
#
# A symlink rather than a copy, and a launcher rather than `npm i -g`: the CLI
# depends on a workspace package that is not on the registry, and a global
# install under a version-managed Node disappears the next time you change Node.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BIN_DIR=${BIN_DIR:-$HOME/.local/bin}

if ! command -v node >/dev/null 2>&1; then
  echo "install-local: node is not on PATH; kamu needs Node 22 or newer." >&2
  exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 22 ]; then
  echo "install-local: Node $major is too old; kamu needs 22 or newer." >&2
  exit 1
fi

if [ "${SKIP_BUILD:-}" = "" ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "install-local: pnpm is not on PATH." >&2
    echo "               install it (npm i -g pnpm), or re-run with SKIP_BUILD=1" >&2
    echo "               if packages/*/dist is already built." >&2
    exit 1
  fi
  ( cd "$root" && pnpm install --frozen-lockfile && pnpm build )
fi

if [ ! -f "$root/packages/cli/dist/cli.js" ]; then
  echo "install-local: nothing built at packages/cli/dist/cli.js." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
ln -sf "$root/bin/kamu" "$BIN_DIR/kamu"
echo "linked $BIN_DIR/kamu → $root/bin/kamu"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: $BIN_DIR is not on your PATH yet." >&2 ;;
esac

cat <<'NEXT'

Point it at a model, then chew something:

  export ANTHROPIC_API_KEY=sk-...        # or --provider claude-code, no key
  kamu README.md --intent "explain it to me like I have never seen it"

`git pull && pnpm build` keeps the linked command up to date.
NEXT
