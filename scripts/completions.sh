#!/usr/bin/env bash
# Shell completions for the relaygent CLI.
# Usage:
#   eval "$(relaygent completions)"        # add to ~/.bashrc or ~/.zshrc
#   relaygent completions >> ~/.bashrc     # or append directly

_relaygent_commands="setup start stop restart status stats test logs orient check health update cleanup clean-logs digest install-services set-password mcp archive-linear open version help"
_relaygent_mcp_commands="list add remove test"
_relaygent_logs_flags="--list -f -n"

if [ -n "$ZSH_VERSION" ]; then
    # --- Zsh completions ---
    _relaygent() {
        local -a commands mcp_cmds
        commands=(
            'setup:Interactive first-time setup wizard'
            'start:Launch agent and all services'
            'stop:Stop everything'
            'restart:Restart all services'
            'status:Show running services'
            'stats:Session history and metrics'
            'test:Run test suite (harness, hub, notifications, ...)'
            'logs:View logs (-f follow, -n lines, --list)'
            'orient:Quick system status snapshot'
            'check:Diagnose configuration'
            'health:Ping all services'
            'update:Pull latest, rebuild, restart'
            'digest:Daily summary of PRs, commits, and status'
            'cleanup:Free disk space (--dry-run)'
            'clean-logs:Remove old logs (--dry-run, --days N)'
            'install-services:Set up auto-restart services'
            'set-password:Set/remove hub auth (--remove)'
            'mcp:Manage MCP servers (list, add, remove, test)'
            'open:Open hub dashboard in browser'
            'archive-linear:Archive old Linear issues'
            'version:Show version info'
            'completions:Output shell completions'
            'help:Show help'
        )
        mcp_cmds=('list:Show configured servers' 'add:Add a server' 'remove:Remove a server' 'test:Verify servers respond')
        if (( CURRENT == 2 )); then
            _describe 'command' commands
        elif (( CURRENT == 3 )); then
            case "${words[2]}" in
                mcp) _describe 'mcp command' mcp_cmds ;;
                logs) compadd -- --list -f -n ;;
                cleanup|clean-logs) compadd -- --dry-run --days ;;
                set-password) compadd -- --remove ;;
            esac
        fi
    }
    if type compdef &>/dev/null; then compdef _relaygent relaygent
    else autoload -Uz compinit && compinit && compdef _relaygent relaygent; fi
else
    # --- Bash completions ---
    _relaygent() {
        local cur prev
        cur="${COMP_WORDS[COMP_CWORD]}"
        prev="${COMP_WORDS[COMP_CWORD-1]}"
        case "$prev" in
            relaygent)
                COMPREPLY=($(compgen -W "$_relaygent_commands completions" -- "$cur")) ;;
            mcp)
                COMPREPLY=($(compgen -W "$_relaygent_mcp_commands" -- "$cur")) ;;
            logs)
                COMPREPLY=($(compgen -W "$_relaygent_logs_flags" -- "$cur")) ;;
            cleanup|clean-logs)
                COMPREPLY=($(compgen -W "--dry-run --days" -- "$cur")) ;;
            set-password)
                COMPREPLY=($(compgen -W "--remove" -- "$cur")) ;;
        esac
    }
    complete -F _relaygent relaygent
fi
