#!/bin/bash
# Orient GPU status — show GPU utilization and memory if nvidia-smi is available
# Sourced by orient.sh (no dependencies beyond nvidia-smi)

command -v nvidia-smi &>/dev/null || return 0

GPU_INFO=$(nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null) || return 0
[ -z "$GPU_INFO" ] && return 0

echo -e "\n\033[0;34mGPUs:\033[0m"
while IFS=', ' read -r idx util mem_used mem_total temp; do
    # Color utilization: green=idle, yellow=moderate, red=high
    if [ "${util:-0}" -gt 80 ] 2>/dev/null; then
        color="\033[0;31m"  # red
    elif [ "${util:-0}" -gt 20 ] 2>/dev/null; then
        color="\033[1;33m"  # yellow
    else
        color="\033[0;32m"  # green
    fi
    mem_pct=0
    [ "${mem_total:-0}" -gt 0 ] 2>/dev/null && mem_pct=$((mem_used * 100 / mem_total))
    echo -e "  GPU $idx: ${color}${util}% util\033[0m, ${mem_used}/${mem_total} MiB (${mem_pct}%), ${temp}C"
done <<< "$GPU_INFO"
