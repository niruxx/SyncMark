#!/usr/bin/env bash
# SyncMark installer for Linux.
#
# Run from inside a SyncMark checkout, as the (non-root) user that should own
# the app:   bash scripts/install.sh
#
# What it does, in order:
#   1. Checks/installs prerequisites: Node.js 18+ (via nvm if missing), npm,
#      git, and — only if the native better-sqlite3 module fails to load — a
#      C/C++ build toolchain.
#   2. Runs `npm ci --omit=dev` and verifies the SQLite module actually loads.
#   3. Leaves data/ completely alone (creates it only if it doesn't exist).
#   4. Offers to create/enable a systemd service so SyncMark starts at boot.
#
# It never deletes or overwrites anything in data/, and it's safe to re-run.
# Run `bash scripts/install.sh --help` for options.

set -Eeuo pipefail

main() {
  local SCRIPT_DIR APP_DIR
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

  local PORT=3000
  local SERVICE_NAME=syncmark
  local SERVICE_MODE=ask     # ask | yes | no
  local ASSUME_YES=0
  local NODE_MIN_MAJOR=18
  local PKG="" NODE_BIN="" RUN_USER=""

  # ---------- output helpers ----------
  local BLUE="" GREEN="" YELLOW="" RED="" BOLD="" RESET=""
  if [ -t 1 ]; then
    BLUE=$'\033[34m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' RESET=$'\033[0m'
  fi
  info() { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
  ok()   { printf '%s ok%s %s\n' "$GREEN" "$RESET" "$*"; }
  warn() { printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
  die()  { printf '%serror%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

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
Usage: bash scripts/install.sh [options]

  --port N           Port SyncMark listens on (default 3000)
  --service MODE     systemd service: ask (default), yes, or no
  --service-name N   systemd unit name (default: syncmark)
  -y, --yes          Non-interactive: accept the default answer to every prompt
                     (installs missing prerequisites, creates + enables + starts
                     the service, but never overwrites an existing unit file)
  -h, --help         Show this help
EOF
  }

  while [ $# -gt 0 ]; do
    case "$1" in
      --port) PORT="${2:-}"; shift 2 ;;
      --service) SERVICE_MODE="${2:-}"; shift 2 ;;
      --service-name) SERVICE_NAME="${2:-}"; shift 2 ;;
      -y|--yes) ASSUME_YES=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Unknown option: $1" ;;
    esac
  done

  case "$SERVICE_MODE" in ask|yes|no) ;; *) die "--service must be ask, yes, or no" ;; esac
  [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "Invalid --port: $PORT"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "Invalid --service-name: $SERVICE_NAME"

  # ---------- preflight ----------
  [ "$(uname -s)" = Linux ] || die "This installer is for Linux. See the README for macOS/Windows."
  [ -f "$APP_DIR/server.js" ] && [ -f "$APP_DIR/package.json" ] || die "Can't find server.js/package.json in $APP_DIR — run this from a SyncMark checkout."
  if [ "$(id -u)" -eq 0 ]; then
    die "Don't run this as root — SyncMark should run as a regular user. Run it as that user; it will call sudo only for package installs and the systemd unit."
  fi
  RUN_USER="$(id -un)"

  as_root() { sudo "$@"; }
  if ! command -v sudo >/dev/null 2>&1; then
    as_root() { die "sudo is required for: $*  (install sudo, or run those steps manually as root)"; }
  fi

  detect_pkg() {
    local m
    for m in apt-get dnf yum pacman zypper apk; do
      if command -v "$m" >/dev/null 2>&1; then PKG="$m"; return; fi
    done
  }
  pkg_install() {
    [ -n "$PKG" ] || die "No supported package manager found — install manually: $*"
    case "$PKG" in
      apt-get) as_root apt-get update && as_root apt-get install -y "$@" ;;
      dnf|yum) as_root "$PKG" install -y "$@" ;;
      pacman)  as_root pacman -S --needed --noconfirm "$@" ;;
      zypper)  as_root zypper --non-interactive install "$@" ;;
      apk)     as_root apk add "$@" ;;
    esac
  }
  build_pkgs() {
    case "$PKG" in
      apt-get) echo "build-essential python3" ;;
      dnf|yum) echo "make gcc-c++ python3" ;;
      pacman)  echo "base-devel python" ;;
      zypper)  echo "make gcc-c++ python3" ;;
      apk)     echo "build-base python3" ;;
    esac
  }
  detect_pkg

  info "Installing SyncMark from $APP_DIR (as user '$RUN_USER')"

  # ---------- Node.js ----------
  node_ok() {
    command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
      [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MIN_MAJOR" ]
  }

  # nvm may already be installed but not loaded in this non-interactive shell.
  if ! node_ok; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      set +u; . "$NVM_DIR/nvm.sh"; nvm use --lts >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true; set -u
    fi
  fi

  if ! node_ok; then
    warn "Node.js $NODE_MIN_MAJOR+ (with npm) was not found."
    ask "Install the current Node.js LTS via nvm into your home directory?" y || die "Node.js $NODE_MIN_MAJOR+ is required. See the README's Linux walkthrough."
    command -v curl >/dev/null 2>&1 || pkg_install curl
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      info "Installing nvm"
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    set +u; . "$NVM_DIR/nvm.sh"; nvm install --lts; set -u
    node_ok || die "Node.js installation did not produce a usable node/npm."
  fi
  NODE_BIN="$(readlink -f "$(command -v node)")"
  ok "Node $(node -v), npm $(npm -v) ($NODE_BIN)"

  if ! command -v git >/dev/null 2>&1; then
    warn "git isn't installed. It isn't needed to run SyncMark, but scripts/update.sh needs it."
    if ask "Install git now?" y; then pkg_install git; fi
  fi

  # ---------- dependencies ----------
  cd "$APP_DIR"

  install_deps() {
    if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
  }
  sqlite_loads() { node -e "require('better-sqlite3')" >/dev/null 2>&1; }

  info "Installing npm dependencies"
  if ! { install_deps && sqlite_loads; }; then
    warn "Dependency install failed or the native SQLite module (better-sqlite3) can't load."
    warn "This usually means no prebuilt binary matched your system and a C/C++ toolchain is needed."
    if ask "Install a build toolchain ($(build_pkgs)) and retry?" y; then
      # shellcheck disable=SC2046
      pkg_install $(build_pkgs)
      install_deps
      sqlite_loads || die "better-sqlite3 still can't load after installing build tools."
    else
      die "Cannot continue without a working better-sqlite3."
    fi
  fi
  ok "Dependencies installed"

  # ---------- data ----------
  if [ -f data/bookmarks.sqlite3 ]; then
    ok "Existing data found in data/ — leaving it untouched"
  else
    mkdir -p data
    ok "data/ is ready (a fresh database is created on first start)"
  fi

  # ---------- systemd ----------
  local UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  local service_started=0

  have_systemd() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }

  render_unit() {
    local dir="${APP_DIR//%/%%}" node="${NODE_BIN//%/%%}"
    cat <<EOF
[Unit]
Description=SyncMark
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$dir
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart="$node" server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
  }

  setup_service() {
    local tmp
    tmp="$(mktemp)"
    render_unit > "$tmp"

    if [ -f "$UNIT_PATH" ]; then
      if cmp -s "$tmp" "$UNIT_PATH"; then
        ok "$UNIT_PATH already matches — leaving it as is"
      else
        warn "$UNIT_PATH already exists and differs from what this installer would write:"
        diff -u "$UNIT_PATH" "$tmp" || true
        if ask "Overwrite it?" n; then
          as_root install -m 644 "$tmp" "$UNIT_PATH"
          ok "Updated $UNIT_PATH"
        else
          info "Keeping the existing unit file"
        fi
      fi
    else
      as_root install -m 644 "$tmp" "$UNIT_PATH"
      ok "Wrote $UNIT_PATH"
    fi
    rm -f "$tmp"

    as_root systemctl daemon-reload

    if ask "Enable $SERVICE_NAME so it starts automatically at boot?" y; then
      as_root systemctl enable "$SERVICE_NAME"
      ok "Enabled at boot"
    fi
    if ask "Start (or restart) $SERVICE_NAME now?" y; then
      as_root systemctl restart "$SERVICE_NAME"
      service_started=1
    fi
  }

  if [ "$SERVICE_MODE" = no ]; then
    info "Skipping systemd setup (--service no)"
  elif ! have_systemd; then
    warn "systemd isn't running on this machine — skipping service setup. See the README's Hosting section for pm2/Docker."
  elif [ "$SERVICE_MODE" = yes ] || ask "Set up a systemd service ($SERVICE_NAME) so SyncMark runs automatically?" y; then
    if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN &&
       ! systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      warn "Port $PORT is already in use by something other than $SERVICE_NAME — the service may fail to start (use --port to pick another)."
    fi
    setup_service
  else
    info "Skipping systemd setup"
  fi

  # ---------- verify + summary ----------
  if [ "$service_started" = 1 ]; then
    info "Waiting for SyncMark to respond on port $PORT"
    local i healthy=0
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if node -e "fetch('http://127.0.0.1:$PORT/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        healthy=1; break
      fi
      sleep 1
    done
    if [ "$healthy" = 1 ]; then
      ok "SyncMark is up"
    else
      warn "SyncMark didn't answer in time. Check:  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
    fi
  fi

  local lan_ip=""
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true

  printf '\n%sDone.%s\n' "$BOLD" "$RESET"
  printf '  Open:   http://localhost:%s%s and complete the first-run setup.\n' "$PORT" "${lan_ip:+   (or http://$lan_ip:$PORT from another device)}"
  if [ "$service_started" = 1 ]; then
    printf '  Status: sudo systemctl status %s     Logs: sudo journalctl -u %s -f\n' "$SERVICE_NAME" "$SERVICE_NAME"
  else
    printf '  Start:  cd %q && PORT=%s npm start\n' "$APP_DIR" "$PORT"
  fi
  printf '  Update: bash %q/scripts/update.sh   (keeps everything in data/)\n' "$APP_DIR"
  printf '  If a firewall is active, allow the port, e.g.  sudo ufw allow %s/tcp\n' "$PORT"
}

main "$@"
exit $?
