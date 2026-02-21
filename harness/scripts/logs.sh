#!/bin/bash
# Relaygent logs — view service logs with filtering and fuzzy matching.
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
LOG_DIR="$REPO_DIR/logs"

usage() {
    echo -e "${CYAN}Usage:${NC} relaygent logs [options] [service]"
    echo ""
    echo "  Without arguments, shows recent relay harness log."
    echo ""
    echo "  Services: relay, hub, notifications, slack, email, autobuild"
    echo "  Partial names work: 'notif' → notifications, 'h' → hub"
    echo ""
    printf "  %-18s %s\n" \
        "-f, --follow" "Follow log output (tail -f)" \
        "-n, --lines N" "Show last N lines (default: 50)" \
        "--list" "List available log files with sizes" \
        "--all" "Follow all relaygent logs combined"
    exit 0
}

# Service name → log file mapping (case + prefix matching)
resolve_log() {
    local svc="$1"
    # Exact and short-name matches
    case "$svc" in
        relay)          echo "relaygent.log"; return 0 ;;
        hub)            echo "relaygent-hub.log"; return 0 ;;
        notifications)  echo "relaygent-notifications.log"; return 0 ;;
        notif|notifs)   echo "relaygent-notifications.log"; return 0 ;;
        slack)          echo "relaygent-slack-socket.log"; return 0 ;;
        email)          echo "email-poller.log"; return 0 ;;
        autobuild)      echo "hub-autobuild.log"; return 0 ;;
    esac
    # Prefix match: try common prefixes
    case "$svc" in
        r*)  echo "relaygent.log"; return 0 ;;
        hu*) echo "relaygent-hub.log"; return 0 ;;
        n*)  echo "relaygent-notifications.log"; return 0 ;;
        s*)  echo "relaygent-slack-socket.log"; return 0 ;;
        e*)  echo "email-poller.log"; return 0 ;;
        a*)  echo "hub-autobuild.log"; return 0 ;;
    esac
    # Glob match in logs directory
    local found
    found=$(ls "$LOG_DIR"/*"$svc"*.log 2>/dev/null | head -1) || true
    if [[ -n "$found" ]]; then
        basename "$found"
        return 0
    fi
    echo -e "${RED}No log found for '$svc'. Use --list to see available logs.${NC}" >&2
    return 1
}

list_logs() {
    if [ ! -d "$LOG_DIR" ]; then
        echo -e "${RED}No logs directory found${NC}"; exit 1
    fi
    echo -e "${CYAN}Available logs:${NC}"
    echo ""
    for f in "$LOG_DIR"/*.log; do
        [ -f "$f" ] || continue
        local name size modified
        name=$(basename "$f")
        size=$(du -h "$f" 2>/dev/null | awk '{print $1}')
        if [ "$(uname)" = "Darwin" ]; then
            modified=$(stat -f "%Sm" -t "%b %d %H:%M" "$f" 2>/dev/null || echo "?")
        else
            modified=$(stat -c "%y" "$f" 2>/dev/null | cut -d. -f1 || echo "?")
        fi
        if [[ "$name" == relaygent* ]]; then
            printf "  ${GREEN}%-35s${NC} %6s  %s\n" "$name" "$size" "$modified"
        else
            printf "  %-35s %6s  %s\n" "$name" "$size" "$modified"
        fi
    done
}

# Parse arguments
FOLLOW=false
LINES=50
LIST=false
ALL=false
SERVICE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--follow) FOLLOW=true; shift ;;
        -n|--lines)
            if [[ -z "${2:-}" ]]; then echo -e "${RED}--lines requires a number${NC}"; exit 1; fi
            LINES="$2"; shift 2 ;;
        --list) LIST=true; shift ;;
        --all) ALL=true; FOLLOW=true; shift ;;
        -h|--help) usage ;;
        -*) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
        *) SERVICE="$1"; shift ;;
    esac
done

# Handle --list
if [ "$LIST" = true ]; then list_logs; exit 0; fi

# Handle --all (follow all relaygent logs)
if [ "$ALL" = true ]; then
    tail -f "$LOG_DIR"/relaygent*.log 2>/dev/null || echo -e "${RED}No relaygent logs found${NC}"
    exit 0
fi

# Resolve target log file
if [ -n "$SERVICE" ]; then
    LOG_NAME=$(resolve_log "$SERVICE") || exit 1
else
    LOG_NAME="relaygent.log"
fi
TARGET="$LOG_DIR/$LOG_NAME"

if [ ! -f "$TARGET" ]; then
    echo -e "${RED}Log not found: $TARGET${NC}"
    echo -e "Run ${CYAN}relaygent logs --list${NC} to see available logs."
    exit 1
fi

# Show or follow
if [ "$FOLLOW" = true ]; then
    echo -e "${CYAN}Following $LOG_NAME${NC} (Ctrl+C to stop)"
    tail -f "$TARGET"
else
    tail -n "$LINES" "$TARGET"
fi
