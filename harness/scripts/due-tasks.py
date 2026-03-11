#!/usr/bin/env python3
"""Parse tasks.md and print due items with overdue severity indicators."""
import re
import sys
from datetime import datetime, timedelta

if len(sys.argv) < 2:
    sys.exit(0)
tasks_file = sys.argv[1]
freqs = {'6h': 0.25, '12h': 0.5, 'daily': 1, '2d': 2, '3d': 3, 'weekly': 7, 'monthly': 30}
now = datetime.now()
due = []  # (severity_ratio, display_string)
try:
    with open(tasks_file) as f: lines = f.readlines()
except OSError:
    sys.exit(0)
for line in lines:
    m = re.match(r'- \[ \] (.+?)(?:\s*\|(.*))?$', line.strip())
    if not m:
        continue
    desc = m.group(1).strip()
    meta = {}
    for p in (m.group(2) or '').split('|'):
        kv = re.match(r'\s*(\w+):\s*(.+)', p.strip())
        if kv:
            meta[kv.group(1)] = kv.group(2).strip()
    ttype = meta.get('type', 'one-off')
    freq = meta.get('freq', '')
    last = meta.get('last', '')
    if ttype == 'one-off':
        due.append((1.0, desc))
    elif ttype == 'recurring' and freq:
        freq_days = freqs.get(freq, 1)
        if not last or last == 'never':
            due.append((99.0, desc))
        else:
            try:
                last_dt = datetime.strptime(last, '%Y-%m-%d %H:%M')
                overdue = now - last_dt - timedelta(days=freq_days)
                if overdue >= timedelta(0):
                    ratio = overdue / timedelta(days=freq_days) if freq_days > 0 else 1
                    # Format how overdue: "2d overdue" or "14d overdue"
                    days_over = overdue.days
                    hours_over = overdue.total_seconds() / 3600
                    if hours_over < 24:
                        tag = f'{int(hours_over)}h overdue'
                    else:
                        tag = f'{days_over}d overdue'
                    # Red for >3x frequency, yellow for >1x
                    if ratio >= 3:
                        label = f'\033[1;31m{desc} ({tag})\033[0m'
                    elif ratio >= 1:
                        label = f'\033[1;33m{desc} ({tag})\033[0m'
                    else:
                        label = f'{desc} ({tag})'
                    due.append((ratio, label))
            except ValueError:
                pass
# Sort by severity (most overdue first)
due.sort(key=lambda x: -x[0])
if due:
    print('\n\033[1;33mTasks due:\033[0m')
    for _, d in due[:6]:
        print(f'  \u2022 {d}')
else:
    print('\n\033[0;34mTasks:\033[0m nothing due')
