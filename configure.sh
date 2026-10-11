#!/usr/bin/env bash
# SyncMark setup menu: install, update or uninstall this checkout.
#
#   bash configure.sh                    # interactive menu
#   bash configure.sh install [options]  # skip the menu; options go to the script
#   bash configure.sh update  [options]
#   bash configure.sh uninstall [options]
#
# This is only a front door — the real work lives in scripts/install.sh,
# scripts/update.sh and scripts/uninstall.sh (each has its own --help).

set -Eeuo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

BOLD="" DIM="" GREEN="" YELLOW="" RED="" RESET=""
if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'
fi

usage() {
  cat <<EOF
Usage: bash configure.sh [install|update|uninstall] [options]

With no action, shows a menu. Any options after the action are passed
straight to that script — see e.g. 'bash configure.sh install --help'.
EOF
}

run() {
  local action=$1
  shift
  local script="$APP_DIR/scripts/$action.sh"
  [ -f "$script" ] || { printf '%serror%s %s is missing\n' "$RED" "$RESET" "$script" >&2; exit 1; }
  exec bash "$script" "$@"
}

case "${1:-}" in
  install|update|uninstall) run "$@" ;;
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) usage >&2; exit 1 ;;
esac

if [ ! -t 0 ]; then
  usage >&2
  printf '\nNo terminal to show the menu on — pass an action instead.\n' >&2
  exit 1
fi

# ---------- current state, so the menu can suggest the right choice ----------
installed=0 service="syncmark" state=""
if [ -f "$APP_DIR/.syncmark-install" ]; then
  installed=1
  service="$(sed -n 's/^SERVICE_NAME=//p' "$APP_DIR/.syncmark-install" | tail -n 1)"
  service="${service:-syncmark}"
elif [ -d "$APP_DIR/node_modules" ]; then
  installed=1
fi
if command -v systemctl >/dev/null 2>&1 && systemctl cat "$service" >/dev/null 2>&1; then
  installed=1
  if systemctl is-active --quiet "$service"; then
    state="${GREEN}running${RESET} (systemd: $service)"
  else
    state="${YELLOW}stopped${RESET} (systemd: $service)"
  fi
fi

printf '\n%sSyncMark setup%s  %s%s%s\n' "$BOLD" "$RESET" "$DIM" "$APP_DIR" "$RESET"
if [ "$installed" = 1 ]; then
  printf '  Status: installed%s\n' "${state:+, $state}"
else
  printf '  Status: not installed\n'
fi

default=1
[ "$installed" = 1 ] && default=2

printf '\n'
printf '  1) Install     dependencies, Node.js if needed, and a systemd service\n'
printf '  2) Update      pull the latest code from git; your data is left alone\n'
printf '  3) Uninstall   remove the service and dependencies (asks about your data)\n'
printf '  q) Quit\n\n'

while true; do
  read -r -p "${BOLD}?${RESET} Choose [1-3, q] (default $default): " choice || exit 1
  case "${choice:-$default}" in
    1|i|install) run install ;;
    2|u|update) run update ;;
    3|uninstall) run uninstall ;;
    q|Q|quit|exit) exit 0 ;;
    *) printf '  Please enter 1, 2, 3 or q.\n' ;;
  esac
done
