#!/usr/bin/env bash
# Shell completions for the relaygent CLI.
# Usage:
#   eval "$(relaygent completions)"        # add to ~/.bashrc or ~/.zshrc
#   relaygent completions >> ~/.bashrc     # or append directly

_relaygent_commands="setup start stop restart status stats tasks history recap session test logs orient check doctor health kb-lint update backup restore cleanup clean-logs changelog digest discover install-services set-password setup-tls config mcp archive-linear open search chat version help"
_relaygent_mcp_commands="list add remove test"
_relaygent_test_suites="harness hub notifications email slack setup secrets computer-use"
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
            'history:Recent sessions timeline (-n NUM, --json)'
            'test:Run test suite (harness, hub, notifications, ...)'
            'logs:View logs (-f follow, -n lines, --list)'
            'orient:Quick system status snapshot'
            'check:Diagnose configuration'
            'doctor:Auto-fix common issues (--dry-run)'
            'health:Ping all services'
            'kb-lint:Check KB health (broken links, orphans)'
            'config:View/edit config (get, set, unset, path)'
            'update:Pull latest, rebuild, restart'
            'changelog:Show recent merged PRs and commits'
            'digest:Daily summary of PRs, commits, and status'
            'backup:Archive KB, config, and data to tarball'
            'restore:Restore from a backup tarball (--dry-run)'
            'cleanup:Free disk space (--dry-run)'
            'clean-logs:Remove old logs (--dry-run, --days N)'
            'install-services:Set up auto-restart services'
            'set-password:Set/remove hub auth (--remove)'
            'setup-tls:Configure HTTPS with Tailscale certs'
            'mcp:Manage MCP servers (list, add, remove, test)'
            'tasks:View/manage recurring tasks (due, done)'
            'recap:Aggregate stats across sessions (-d DAYS, --json)'
            'session:Live session stats (--json)'
            'search:Search KB, sessions, and chat'
            'chat:Send a message to the agent (--read to view)'
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
                test) compadd -- harness hub notifications email slack setup secrets computer-use ;;
                logs) compadd -- --list -f -n ;;
                history) compadd -- -n --json ;;
                recap) compadd -- -d --days --json ;;
                session) compadd -- --json --watch ;;
                tasks) compadd -- list due done ;;
                doctor) compadd -- --dry-run ;;
                restore) compadd -- --dry-run --yes ;;
                cleanup|clean-logs) compadd -- --dry-run --days ;;
                set-password) compadd -- --remove ;;
                config) compadd -- get set unset path ;;
                search) compadd -- --type --json ;;
                chat) compadd -- --read --follow ;;
                open) compadd -- intent kb tasks sessions logs files search notifications settings help ;;
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
            test)
                COMPREPLY=($(compgen -W "$_relaygent_test_suites" -- "$cur")) ;;
            logs)
                COMPREPLY=($(compgen -W "$_relaygent_logs_flags" -- "$cur")) ;;
            history)
                COMPREPLY=($(compgen -W "-n --json" -- "$cur")) ;;
            recap)
                COMPREPLY=($(compgen -W "-d --days --json" -- "$cur")) ;;
            session)
                COMPREPLY=($(compgen -W "--json --watch" -- "$cur")) ;;
            tasks)
                COMPREPLY=($(compgen -W "list due done" -- "$cur")) ;;
            doctor)
                COMPREPLY=($(compgen -W "--dry-run" -- "$cur")) ;;
            restore)
                COMPREPLY=($(compgen -W "--dry-run --yes" -- "$cur")) ;;
            cleanup|clean-logs)
                COMPREPLY=($(compgen -W "--dry-run --days" -- "$cur")) ;;
            set-password)
                COMPREPLY=($(compgen -W "--remove" -- "$cur")) ;;
            config)
                COMPREPLY=($(compgen -W "get set unset path" -- "$cur")) ;;
            search)
                COMPREPLY=($(compgen -W "--type --json" -- "$cur")) ;;
            chat)
                COMPREPLY=($(compgen -W "--read" -- "$cur")) ;;
            open)
                COMPREPLY=($(compgen -W "intent kb tasks sessions logs files search notifications settings help" -- "$cur")) ;;
        esac
    }
    complete -F _relaygent relaygent
fi
