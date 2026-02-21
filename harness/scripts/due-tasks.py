#!/usr/bin/env python3
"""Parse tasks.md and print due items (one-off + overdue recurring)."""
import re
import sys
from datetime import datetime, timedelta

if len(sys.argv) < 2:
    sys.exit(0)
tasks_file = sys.argv[1]
freqs = {'6h': 0.25, '12h': 0.5, 'daily': 1, '2d': 2, '3d': 3, 'weekly': 7, 'monthly': 30}
now = datetime.now()
due = []
try:
    lines = open(tasks_file).readlines()
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
        due.append(desc)
    elif ttype == 'recurring' and freq:
        if not last or last == 'never':
            due.append(desc)
        else:
            try:
                last_dt = datetime.strptime(last, '%Y-%m-%d %H:%M')
                if now - last_dt >= timedelta(days=freqs.get(freq, 1)):
                    due.append(desc)
            except ValueError:
                pass
if due:
    print('\n\033[1;33mTasks due:\033[0m')
    for d in due[:5]:
        print(f'  \u2022 {d}')
else:
    print('\n\033[0;34mTasks:\033[0m nothing due')
