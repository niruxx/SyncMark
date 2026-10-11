#!/usr/bin/env bash
# SyncMark uninstaller for Linux.
#
# Undoes what scripts/install.sh did, as the same (non-root) user:
#   bash scripts/uninstall.sh
#
# What it does, in order (asking before anything destructive):
#   1. Stops and disables the systemd service and removes its unit file.
#   2. Deletes node_modules/.
#   3. Your data (data/: database, accounts, password vault, config, backups):
#      kept by default. If you choose to delete it, it is first archived to
#      your home directory unless you explicitly decline.
#   4. Node.js/nvm and the npm cache — only if install.sh installed them.
#   5. OS packages — only ones install.sh itself installed (recorded in
#      .syncmark-install), never anything that was already on the system.
#      These default to "keep": other software may rely on them.
#   6. Optionally (--purge) deletes this SyncMark directory itself.
#
# Folders you registered as Files locations live outside SyncMark and are
# never touched. Run `bash scripts/uninstall.sh --help` for options.

set -Eeuo pipefail

main() {
  local SCRIPT_DIR APP_DIR DATA_DIR
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
  DATA_DIR="$APP_DIR/data"

  local SERVICE_NAME="" ASSUME_YES=0 PURGE=0
  local DATA_MODE=ask      # ask | keep | delete
  local PKG_MODE=ask       # ask | keep | remove
  local BACKUP_DATA=1

  local BLUE="" GREEN="" YELLOW="" RED="" BOLD="" RESET=""
  if [ -t 1 ]; then
    BLUE=$'\033[34m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' RESET=$'\033[0m'
  fi
  info() { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
  ok()   { printf '%s ok%s %s\n' "$GREEN" "$RESET" "$*"; }
  warn() { printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
  die()  { printf '%serror%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
  banner() { printf '\n%s%s!! %s%s\n' "$RED" "$BOLD" "$*" "$RESET" >&2; }

  # ask "question" default(y|n) — non-interactive runs (or --yes) take the default.
  ask() {
    local prompt=$1 default=${2:-y} reply hint="[Y/n]"
    [ "$default" = n ] && hint="[y/N]"
    if [ "$ASSUME_YES" = 1 ] || [ ! -t 0 ]; then
      [ "$default" = y ]
      return
    fi
    read -r -p "$BOLD?$RESET $prompt $hint " reply || reply=""
    reply="${reply:-$default}"
    case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
  }

  usage() {
    cat <<EOF
Usage: bash scripts/uninstall.sh [options]

  --keep-data          Keep data/ (database, accounts, vault, config, backups)
  --delete-data        Delete data/ (archived to your home directory first)
  --no-data-backup     With --delete-data: don't archive it first (unrecoverable)
  --remove-packages    Remove the OS packages install.sh installed
  --keep-packages      Keep them (the default answer)
  --purge              Also delete this SyncMark directory ($APP_DIR)
  --service-name N     systemd unit to remove (default: from the install record, else syncmark)
  -y, --yes            Non-interactive: take the default answer everywhere —
                       removes the service and node_modules, KEEPS data/ and
                       OS packages unless --delete-data / --remove-packages are given
  -h, --help           Show this help
EOF
  }

  while [ $# -gt 0 ]; do
    case "$1" in
      --keep-data) DATA_MODE=keep; shift ;;
      --delete-data) DATA_MODE=delete; shift ;;
      --no-data-backup) BACKUP_DATA=0; shift ;;
      --remove-packages) PKG_MODE=remove; shift ;;
      --keep-packages) PKG_MODE=keep; shift ;;
      --purge) PURGE=1; shift ;;
      --service-name) SERVICE_NAME="${2:-}"; shift 2 ;;
      -y|--yes) ASSUME_YES=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Unknown option: $1" ;;
    esac
  done

  # ---------- preflight ----------
  [ "$(uname -s)" = Linux ] || die "This uninstaller is for Linux."
  [ -f "$APP_DIR/server.js" ] && [ -f "$APP_DIR/package.json" ] || die "Can't find server.js/package.json in $APP_DIR — run this from the SyncMark directory."
  if [ "$(id -u)" -eq 0 ]; then
    die "Don't run this as root — run it as the user that installed SyncMark; it calls sudo only where needed."
  fi

  as_root() { sudo "$@"; }
  if ! command -v sudo >/dev/null 2>&1; then
    as_root() { die "sudo is required for: $*  (install sudo, or run those steps manually as root)"; }
  fi

  # ---------- install record ----------
  # Parsed, never sourced: it's plain KEY=value lines written by install.sh.
  local MANIFEST="$APP_DIR/.syncmark-install" HAVE_MANIFEST=0
  [ -f "$MANIFEST" ] && HAVE_MANIFEST=1
  manifest_get() { [ -f "$MANIFEST" ] && sed -n "s/^$1=//p" "$MANIFEST" | tail -n 1; return 0; }

  local M_SERVICE M_UNIT_PATH M_UNIT_CREATED M_PKG M_PACKAGES M_NVM_INSTALLED M_NVM_DIR M_NVM_NODE M_NPM_PRE M_USER
  M_SERVICE="$(manifest_get SERVICE_NAME)"
  M_UNIT_PATH="$(manifest_get UNIT_PATH)"
  M_UNIT_CREATED="$(manifest_get UNIT_CREATED)"
  M_PKG="$(manifest_get PKG_MANAGER)"
  M_PACKAGES="$(manifest_get PACKAGES)"
  M_NVM_INSTALLED="$(manifest_get NVM_INSTALLED)"
  M_NVM_DIR="$(manifest_get NVM_DIR)"
  M_NVM_NODE="$(manifest_get NVM_NODE_VERSION)"
  M_NPM_PRE="$(manifest_get NPM_CACHE_PREEXISTED)"
  M_USER="$(manifest_get RUN_USER)"

  if [ -n "$M_USER" ] && [ "$M_USER" != "$(id -un)" ]; then
    warn "SyncMark was installed by '$M_USER', but you're '$(id -un)'. nvm/npm cleanup applies to the current user's home only."
  fi

  [ -n "$SERVICE_NAME" ] || SERVICE_NAME="${M_SERVICE:-syncmark}"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "Invalid --service-name: $SERVICE_NAME"
  local UNIT_PATH="${M_UNIT_PATH:-/etc/systemd/system/${SERVICE_NAME}.service}"

  printf '%sUninstalling SyncMark%s from %s\n' "$BOLD" "$RESET" "$APP_DIR"
  if [ "$HAVE_MANIFEST" = 0 ]; then
    warn "No install record (.syncmark-install) found — this install predates it, or wasn't done by install.sh."
    warn "The service and node_modules can still be removed, but OS packages can't be identified safely, so none will be removed."
  fi
  ask "Continue?" y || { info "Cancelled — nothing changed."; return 0; }

  # ---------- 1. systemd service ----------
  have_systemd() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }

  if have_systemd && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
    local unit_dir ours=0
    unit_dir="$(systemctl show "$SERVICE_NAME" -p WorkingDirectory --value 2>/dev/null || true)"
    if [ -n "$unit_dir" ] && [ "$(readlink -f "$unit_dir" 2>/dev/null || echo "$unit_dir")" = "$APP_DIR" ]; then
      ours=1
    fi
    if [ "$ours" = 0 ]; then
      warn "systemd unit '$SERVICE_NAME' runs from '${unit_dir:-?}', not $APP_DIR — it belongs to another install, leaving it alone."
    else
      info "Removing systemd service $SERVICE_NAME"
      as_root systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      as_root systemctl disable "$SERVICE_NAME" 2>/dev/null || true
      if [ -f "$UNIT_PATH" ]; then
        as_root rm -f "$UNIT_PATH"
        ok "Removed $UNIT_PATH"
      fi
      # Drop-ins come from `systemctl edit` — yours, not the installer's.
      if [ -d "${UNIT_PATH}.d" ]; then
        if ask "Also remove your local overrides in ${UNIT_PATH}.d?" y; then
          as_root rm -rf -- "${UNIT_PATH}.d"
          ok "Removed ${UNIT_PATH}.d"
        fi
      fi
      as_root systemctl daemon-reload
      as_root systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
      ok "Service removed"
    fi
  elif [ "$M_UNIT_CREATED" = 1 ] && [ -f "$UNIT_PATH" ]; then
    as_root rm -f "$UNIT_PATH"
    ok "Removed leftover $UNIT_PATH"
  else
    info "No systemd service named '$SERVICE_NAME' — skipping"
  fi

  # Anything still serving from this directory (e.g. a manual `npm start`)?
  local pid
  for pid in $(pgrep -u "$(id -u)" -x node 2>/dev/null || true); do
    if [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$APP_DIR" ]; then
      warn "SyncMark is still running outside systemd (PID $pid — e.g. 'npm start' or pm2). Stop it yourself."
      break
    fi
  done

  # ---------- 2. node_modules ----------
  if [ -d "$APP_DIR/node_modules" ]; then
    rm -rf -- "$APP_DIR/node_modules"
    ok "Removed node_modules/"
  fi

  # ---------- 3. data ----------
  # Archives go to $HOME — or next to the checkout if $HOME is somehow inside
  # it, so --purge can never delete the archive it just made.
  archive_path() {
    local dir="$HOME"
    case "$(readlink -f "$dir")/" in "$APP_DIR"/*) dir="$(dirname -- "$APP_DIR")" ;; esac
    printf '%s/syncmark-data-%s.tar.gz' "$dir" "$(date +%Y%m%d-%H%M%S)"
  }
  local data_present=0 DATA_ARCHIVE=""
  if [ -d "$DATA_DIR" ] && [ -n "$(find "$DATA_DIR" -mindepth 1 ! -name '*.example.json' -print -quit)" ]; then
    data_present=1
  fi

  if [ "$data_present" = 1 ]; then
    if [ "$DATA_MODE" = ask ]; then
      banner "Your SyncMark data is in $DATA_DIR"
      printf '   %s\n' "Database (bookmarks, contacts, calendar, password vault, all user accounts)," \
        "admin.json, config.json, scheduled backups and pre-update backups." >&2
      du -sh "$DATA_DIR" 2>/dev/null | awk '{print "   Size: " $1}' >&2 || true
      if ask "DELETE all of it?" n; then DATA_MODE=delete; else DATA_MODE=keep; fi
    fi

    if [ "$DATA_MODE" = delete ]; then
      if [ "$BACKUP_DATA" = 1 ]; then
        DATA_ARCHIVE="$(archive_path)"
        info "Archiving data/ to $DATA_ARCHIVE before deleting it"
        tar -czf "$DATA_ARCHIVE" -C "$APP_DIR" data || die "Couldn't create the archive — nothing was deleted."
        chmod 600 "$DATA_ARCHIVE"
        ok "Archived (delete it yourself once you're sure: rm $DATA_ARCHIVE)"
      else
        banner "Deleting data/ WITHOUT a backup — this cannot be undone."
        if [ "$ASSUME_YES" = 0 ] && [ -t 0 ]; then
          local confirm=""
          read -r -p "Type DELETE to confirm: " confirm || confirm=""
          [ "$confirm" = DELETE ] || die "Not confirmed — nothing in data/ was deleted."
        fi
      fi
      # Remove everything except the tracked example files, which belong to
      # the checkout rather than to your install.
      find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name '*.example.json' -exec rm -rf -- {} +
      ok "Deleted the contents of data/"
    else
      ok "Keeping data/ — reinstalling later picks it straight back up"
    fi
  fi

  # ---------- 4. Node.js / nvm / npm cache ----------
  local nvm_dir="${M_NVM_DIR:-$HOME/.nvm}" nvm_removed=0
  if [ "$M_NVM_INSTALLED" = 1 ] && [ -d "$nvm_dir" ]; then
    banner "install.sh installed nvm (and Node.js through it) in $nvm_dir"
    printf '   %s\n' "Anything else you've since set up with nvm/node/npm will stop working." >&2
    if ask "Remove nvm and every Node.js version it manages?" n; then
      rm -rf -- "$nvm_dir"
      local rc
      for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc"; do
        if [ -f "$rc" ] && grep -q 'NVM_DIR' "$rc"; then
          cp -p "$rc" "$rc.syncmark-uninstall.bak"
          sed -i '/NVM_DIR/d' "$rc"
          ok "Removed nvm's lines from $rc (backup: $rc.syncmark-uninstall.bak)"
        fi
      done
      nvm_removed=1
      ok "Removed nvm"
    fi
  elif [ -n "$M_NVM_NODE" ] && [ -s "$nvm_dir/nvm.sh" ]; then
    warn "install.sh added Node.js $M_NVM_NODE to your existing nvm."
    if ask "Uninstall Node.js $M_NVM_NODE from nvm? (other projects may use it)" n; then
      set +u
      # shellcheck disable=SC1091
      . "$nvm_dir/nvm.sh"
      nvm deactivate >/dev/null 2>&1 || true
      if nvm uninstall "$M_NVM_NODE"; then ok "Removed Node.js $M_NVM_NODE"; else warn "nvm couldn't remove $M_NVM_NODE"; fi
      set -u
    fi
  fi

  if [ "$M_NPM_PRE" = 0 ] && [ -d "$HOME/.npm" ]; then
    if [ "$nvm_removed" = 1 ] || ask "Remove the npm cache ($HOME/.npm)? It didn't exist before SyncMark; it's only a download cache." y; then
      rm -rf -- "$HOME/.npm"
      ok "Removed $HOME/.npm"
    fi
  fi

  # ---------- 5. OS packages ----------
  pkg_is_installed() {
    case "$M_PKG" in
      apt-get) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed' ;;
      dnf|yum|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
      pacman)  pacman -Qq "$1" >/dev/null 2>&1 ;;
      apk)     apk info -e "$1" >/dev/null 2>&1 ;;
      *) return 1 ;;
    esac
  }

  local still=() p
  for p in $M_PACKAGES; do
    if pkg_is_installed "$p"; then still+=("$p"); fi
  done

  if [ ${#still[@]} -gt 0 ]; then
    banner "install.sh installed these OS packages: ${still[*]}"
    printf '   %s\n' \
      "They are general-purpose tools (e.g. git, curl, compilers) and other software" \
      "on this machine may now depend on them. Removing them can also remove" \
      "packages that depend on them — read the package manager's list carefully." >&2
    if [ "$PKG_MODE" = ask ]; then
      if ask "Remove these packages?" n; then PKG_MODE=remove; else PKG_MODE=keep; fi
    fi
    if [ "$PKG_MODE" = remove ]; then
      # Interactive removal (no -y) so the package manager shows exactly what
      # else would go and lets you back out; --yes makes it non-interactive.
      local auto=()
      if [ "$ASSUME_YES" = 1 ]; then
        case "$M_PKG" in
          apt-get|dnf|yum) auto=(-y) ;;
          pacman) auto=(--noconfirm) ;;
          zypper) auto=(--non-interactive) ;;
        esac
      fi
      case "$M_PKG" in
        apt-get) as_root apt-get remove "${auto[@]}" "${still[@]}" ;;
        dnf|yum) as_root "$M_PKG" remove "${auto[@]}" "${still[@]}" ;;
        pacman)  as_root pacman -R "${auto[@]}" "${still[@]}" ;;
        zypper)  as_root zypper "${auto[@]}" remove "${still[@]}" ;;
        apk)     as_root apk del "${still[@]}" ;;
      esac || warn "Package removal didn't complete — remove them yourself if you still want to."
      if [ "$M_PKG" = apt-get ]; then
        info "Leftover dependencies can be cleared with: sudo apt-get autoremove"
      fi
    else
      ok "Keeping OS packages"
    fi
  elif [ "$HAVE_MANIFEST" = 1 ]; then
    ok "install.sh didn't install any OS packages — nothing to remove"
  fi

  # ---------- 6. install record / purge ----------
  rm -f -- "$MANIFEST"

  if [ "$PURGE" = 1 ]; then
    if [ "$DATA_MODE" != delete ] && [ "$data_present" = 1 ]; then
      DATA_ARCHIVE="$(archive_path)"
      info "Keeping your data: archiving data/ to $DATA_ARCHIVE before deleting the directory"
      tar -czf "$DATA_ARCHIVE" -C "$APP_DIR" data || die "Couldn't archive data/ — not deleting $APP_DIR."
      chmod 600 "$DATA_ARCHIVE"
    fi
    if ask "Delete the SyncMark directory $APP_DIR?" y; then
      cd /
      rm -rf -- "$APP_DIR"
      ok "Deleted $APP_DIR"
    fi
  fi

  printf '\n%sSyncMark has been uninstalled.%s\n' "$BOLD" "$RESET"
  [ -z "$DATA_ARCHIVE" ] || printf '  Data archive: %s  (restore: tar -xzf it inside a SyncMark checkout)\n' "$DATA_ARCHIVE"
  if [ "$PURGE" = 0 ]; then
    printf '  The code is still in %s — delete it with rm -rf, or reinstall with scripts/install.sh.\n' "$APP_DIR"
  fi
  printf '  Folders you added as Files locations, and any backup folder outside data/, were not touched.\n'
  if [ "$nvm_removed" = 1 ]; then
    printf '  Open a new terminal so your shell forgets nvm.\n'
  fi
}

main "$@"
exit $?
