#!/usr/bin/env bash
# SyncMark updater for Linux.
#
# Brings this checkout up to date with the latest commits on origin and
# restarts the systemd service, WITHOUT touching your data:
#   bash scripts/update.sh
#
# Order of operations: check for local edits -> fetch -> show what's incoming
# -> back up data/ -> stop the service -> fast-forward the code -> npm ci ->
# start the service -> health check. If installing dependencies fails, the
# code is rolled back to the commit you started on and the service is restarted.
#
# Your data lives in data/ (git-ignored). This script never runs `git clean`,
# never deletes anything in data/, and `git reset --hard` (only used with
# --discard-local-changes) only ever touches tracked files.
# Run `bash scripts/update.sh --help` for options.

set -Eeuo pipefail

# Everything lives in main() and is invoked on the last line: bash reads a
# script incrementally, so without this, `git pull` replacing update.sh
# mid-run could make bash execute a mix of old and new lines.
main() {
  local SCRIPT_DIR APP_DIR DATA_DIR
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
  DATA_DIR="$APP_DIR/data"

  local BRANCH="" SERVICE_NAME=syncmark
  local ASSUME_YES=0 DISCARD=0 FORCE=0 SKIP_BACKUP=0 SKIP_INSTALL=0 NO_RESTART=0
  local KEEP_BACKUPS=5

  local BLUE="" GREEN="" YELLOW="" RED="" BOLD="" RESET=""
  if [ -t 1 ]; then
    BLUE=$'\033[34m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' RESET=$'\033[0m'
  fi
  info() { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
  ok()   { printf '%s ok%s %s\n' "$GREEN" "$RESET" "$*"; }
  warn() { printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
  die()  { printf '%serror%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

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
Usage: bash scripts/update.sh [options]

  --branch NAME          Branch to update to (default: the branch currently checked out)
  --service-name N       systemd unit to stop/start around the update (default: syncmark)
  -y, --yes              Don't ask for confirmation
  --discard-local-changes
                         Make tracked files match origin exactly (git reset --hard),
                         discarding local edits/commits to tracked files. data/ is
                         never affected. Without this flag, local edits abort the update.
  --force                Re-run the dependency install and restart even if already up to date
  --no-backup            Skip the pre-update copy of data/ (not recommended)
  --skip-install         Skip 'npm ci' (only if you know dependencies didn't change)
  --no-restart           Don't stop/start the service; restart it yourself afterward
  -h, --help             Show this help

Pre-update backups go to data/pre-update-backups/ (the newest $KEEP_BACKUPS are kept).
EOF
  }

  while [ $# -gt 0 ]; do
    case "$1" in
      --branch) BRANCH="${2:-}"; shift 2 ;;
      --service-name) SERVICE_NAME="${2:-}"; shift 2 ;;
      -y|--yes) ASSUME_YES=1; shift ;;
      --discard-local-changes) DISCARD=1; shift ;;
      --force) FORCE=1; shift ;;
      --no-backup) SKIP_BACKUP=1; shift ;;
      --skip-install) SKIP_INSTALL=1; shift ;;
      --no-restart) NO_RESTART=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Unknown option: $1" ;;
    esac
  done
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "Invalid --service-name: $SERVICE_NAME"

  # ---------- preflight ----------
  command -v git >/dev/null 2>&1 || die "git is required to update. Install it first (e.g. sudo apt-get install -y git)."
  cd "$APP_DIR"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR isn't a git checkout, so it can't be updated in place. See the README's 'Downloading a fresh copy without git' section."
  git remote get-url origin >/dev/null 2>&1 || die "This checkout has no 'origin' remote to update from."

  if [ "$SKIP_INSTALL" = 0 ] && ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      set +u; . "$NVM_DIR/nvm.sh"; nvm use --lts >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true; set -u
    fi
    command -v npm >/dev/null 2>&1 || die "npm not found. Install Node.js first (see scripts/install.sh)."
  fi

  local CURRENT_BRANCH
  CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
  [ -n "$BRANCH" ] || BRANCH="$CURRENT_BRANCH"
  [ -n "$BRANCH" ] || die "HEAD is detached — pass --branch <name> (usually main)."

  # Tracked-file edits only: data/ and node_modules/ are ignored, so they never appear here.
  local dirty
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    if [ "$DISCARD" = 1 ]; then
      warn "Local changes to tracked files will be discarded:"
      printf '%s\n' "$dirty" >&2
    else
      printf '%s\n' "$dirty" >&2
      die "You have local changes to tracked files (listed above). Commit/stash them, or re-run with --discard-local-changes to overwrite them. Nothing in data/ is affected either way."
    fi
  fi

  # ---------- what's incoming ----------
  info "Fetching origin/$BRANCH"
  git fetch --quiet origin "$BRANCH"

  local OLD NEW
  OLD="$(git rev-parse HEAD)"
  NEW="$(git rev-parse "origin/$BRANCH")"

  if [ "$OLD" = "$NEW" ] && [ "$BRANCH" = "$CURRENT_BRANCH" ] && [ "$FORCE" = 0 ]; then
    [ -z "$dirty" ] || [ "$DISCARD" = 0 ] || git reset --hard --quiet
    ok "Already up to date ($(git rev-parse --short HEAD)) — nothing to do."
    return 0
  fi

  local can_ff=1
  git merge-base --is-ancestor "$OLD" "$NEW" 2>/dev/null || can_ff=0
  if [ "$can_ff" = 0 ] && [ "$DISCARD" = 0 ]; then
    die "Local history has diverged from origin/$BRANCH (you have commits origin doesn't). Re-run with --discard-local-changes to make this checkout match origin exactly."
  fi

  if [ "$OLD" != "$NEW" ]; then
    info "Incoming commits ($(git rev-parse --short "$OLD") -> $(git rev-parse --short "$NEW")):"
    git --no-pager log --oneline --no-decorate -n 25 "$OLD..$NEW" | sed 's/^/    /'
    local total
    total="$(git rev-list --count "$OLD..$NEW")"
    [ "$total" -le 25 ] || printf '    ... and %s more\n' "$((total - 25))"
  fi

  ask "Update now?" y || { info "Cancelled — nothing changed."; return 0; }

  # ---------- systemd ----------
  local MANAGED=0 WAS_ACTIVE=0 PORT=3000
  as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

  if [ "$NO_RESTART" = 0 ] && command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
    local unit_dir
    unit_dir="$(systemctl show "$SERVICE_NAME" -p WorkingDirectory --value 2>/dev/null || true)"
    if [ -n "$unit_dir" ] && [ "$(readlink -f "$unit_dir" 2>/dev/null || echo "$unit_dir")" = "$APP_DIR" ]; then
      MANAGED=1
      systemctl is-active --quiet "$SERVICE_NAME" && WAS_ACTIVE=1
      local envline
      envline="$(systemctl show "$SERVICE_NAME" -p Environment --value 2>/dev/null || true)"
      if [[ "$envline" =~ (^|[[:space:]])PORT=([0-9]+) ]]; then PORT="${BASH_REMATCH[2]}"; fi
    else
      warn "systemd unit '$SERVICE_NAME' exists but runs from '${unit_dir:-?}', not $APP_DIR — leaving it alone. Restart it yourself after the update."
    fi
  fi

  # ---------- back up data/ ----------
  local BACKUP_DIR=""
  if [ "$SKIP_BACKUP" = 1 ]; then
    warn "Skipping pre-update backup (--no-backup)"
  elif [ -d "$DATA_DIR" ]; then
    local root="$DATA_DIR/pre-update-backups"
    BACKUP_DIR="$root/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short "$OLD")"
    mkdir -p "$BACKUP_DIR"
    info "Backing up data/ to ${BACKUP_DIR#"$APP_DIR"/}"

    if [ -f "$DATA_DIR/bookmarks.sqlite3" ]; then
      # SQLite's online backup API gives a consistent snapshot even while the
      # server is running in WAL mode; plain file copies are the fallback.
      if [ -d node_modules/better-sqlite3 ] && node -e '
          const D = require("better-sqlite3");
          const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
          db.backup(process.argv[2]).then(() => db.close()).catch((e) => { console.error(e.message); process.exit(1); });
        ' "$DATA_DIR/bookmarks.sqlite3" "$BACKUP_DIR/bookmarks.sqlite3" 2>/dev/null; then
        ok "Database snapshot saved"
      else
        warn "Online snapshot unavailable — falling back to copying the database files"
        local f
        for f in bookmarks.sqlite3 bookmarks.sqlite3-wal bookmarks.sqlite3-shm; do
          [ -f "$DATA_DIR/$f" ] && cp -p "$DATA_DIR/$f" "$BACKUP_DIR/$f"
        done
      fi
    fi
    [ -f "$DATA_DIR/admin.json" ] && cp -p "$DATA_DIR/admin.json" "$BACKUP_DIR/admin.json"

    # Prune: keep only the newest $KEEP_BACKUPS pre-update backups.
    local d n=0
    while IFS= read -r d; do
      n=$((n + 1))
      [ "$n" -le "$KEEP_BACKUPS" ] || rm -rf -- "$d"
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d | sort -r)
  else
    info "No data/ directory yet — nothing to back up"
  fi

  # ---------- stop, update code, install deps ----------
  service_stop()  { [ "$MANAGED" = 1 ] && [ "$WAS_ACTIVE" = 1 ] && { info "Stopping $SERVICE_NAME"; as_root systemctl stop "$SERVICE_NAME"; } || true; }
  service_start() { [ "$MANAGED" = 1 ] && [ "$WAS_ACTIVE" = 1 ] && { info "Starting $SERVICE_NAME"; as_root systemctl start "$SERVICE_NAME"; } || true; }
  install_deps() {
    [ "$SKIP_INSTALL" = 1 ] && return 0
    if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
  }
  sync_code() {
    if [ "$1" = hard ]; then
      [ "$BRANCH" = "$(git symbolic-ref --quiet --short HEAD || true)" ] || git checkout --quiet "$BRANCH"
      git reset --hard --quiet "$2"
    else
      [ "$BRANCH" = "$(git symbolic-ref --quiet --short HEAD || true)" ] || git checkout --quiet "$BRANCH"
      git merge --ff-only --quiet "$2"
    fi
  }

  service_stop

  info "Updating code"
  if [ "$can_ff" = 1 ] && [ "$DISCARD" = 0 ]; then
    sync_code ff "origin/$BRANCH"
  else
    sync_code hard "origin/$BRANCH"
  fi
  ok "Code is now at $(git rev-parse --short HEAD)"

  info "Installing dependencies"
  if ! install_deps; then
    warn "Dependency install failed — rolling the code back to $(git rev-parse --short "$OLD")"
    sync_code hard "$OLD" || true
    install_deps || warn "Could not restore the previous dependencies either; run 'npm ci --omit=dev' manually."
    service_start
    die "Update aborted; your data was not modified${BACKUP_DIR:+ (backup: $BACKUP_DIR)}."
  fi
  ok "Dependencies up to date"

  # ---------- restart + verify ----------
  service_start

  if [ "$MANAGED" = 1 ] && [ "$WAS_ACTIVE" = 1 ]; then
    info "Waiting for SyncMark to respond on port $PORT"
    local i healthy=0
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if node -e "fetch('http://127.0.0.1:$PORT/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        healthy=1; break
      fi
      sleep 1
    done
    if [ "$healthy" = 1 ]; then
      ok "SyncMark is up"
    else
      warn "SyncMark didn't answer on port $PORT. Check:  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
      warn "To go back:  git reset --hard $OLD && npm ci --omit=dev && sudo systemctl restart $SERVICE_NAME"
      [ -z "$BACKUP_DIR" ] || warn "Your pre-update data copy is in $BACKUP_DIR"
      exit 1
    fi
  elif [ "$MANAGED" = 1 ]; then
    info "$SERVICE_NAME wasn't running before the update, so it was left stopped."
  else
    warn "No matching systemd service was found — restart SyncMark yourself (e.g. stop the old process, then 'npm start')."
  fi

  printf '\n%sUpdated%s %s -> %s\n' "$BOLD" "$RESET" "$(git rev-parse --short "$OLD")" "$(git rev-parse --short HEAD)"
  [ -z "$BACKUP_DIR" ] || printf '  Pre-update data copy: %s\n' "$BACKUP_DIR"
  printf '  Schema migrations, if any, run automatically the first time the new version starts.\n'
}

main "$@"
exit $?
