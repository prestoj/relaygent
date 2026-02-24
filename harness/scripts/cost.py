#!/usr/bin/env python3
"""relaygent cost — estimate API costs from session token data."""
from __future__ import annotations
import json, os, re, sys
from datetime import datetime, timedelta
from pathlib import Path

# Pricing per million tokens (USD, as of 2025)
PRICING = {
    'opus':   {'input': 15.0,  'output': 75.0, 'cache_write': 18.75, 'cache_read': 1.50},
    'sonnet': {'input': 3.0,   'output': 15.0, 'cache_write': 3.75,  'cache_read': 0.30},
    'haiku':  {'input': 0.80,  'output': 4.0,  'cache_write': 1.0,   'cache_read': 0.08},
}
M = 1_000_000


def model_tier(name: str | None) -> str:
    if not name:
        return 'sonnet'
    n = name.lower()
    if 'opus' in n:
        return 'opus'
    if 'haiku' in n:
        return 'haiku'
    return 'sonnet'


def get_runs_prefix() -> str | None:
    try:
        cfg = json.load(open(Path.home() / '.relaygent' / 'config.json'))
        return os.path.join(cfg['paths']['repo'], 'harness', 'runs').replace('/', '-').replace('.', '-')
    except Exception:
        return None


def find_sessions(days: int | None = None) -> list[dict]:
    projects = Path.home() / '.claude' / 'projects'
    prefix = get_runs_prefix()
    cutoff = datetime.now() - timedelta(days=days) if days else None
    sessions = []
    try:
        for d in sorted(os.listdir(projects)):
            if prefix and not d.startswith(prefix):
                continue
            full = projects / d
            if not full.is_dir():
                continue
            m = re.search(r'(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$', d)
            if not m:
                continue
            dt = datetime(*(int(m[i]) for i in range(1, 7)))
            if cutoff and dt < cutoff:
                continue
            for f in os.listdir(full):
                if not f.endswith('.jsonl'):
                    continue
                fp = full / f
                if fp.stat().st_size < 500:
                    continue
                sessions.append({'path': str(fp), 'time': dt, 'id': f[:8]})
    except Exception:
        pass
    return sessions


def parse_usage(path: str) -> dict:
    totals: dict[str, dict[str, int]] = {}  # tier -> {input, cache_write, cache_read, output}
    start_ts = end_ts = None
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
                ts = e.get('timestamp')
                if ts:
                    if not start_ts:
                        start_ts = ts
                    end_ts = ts
                if e.get('type') != 'assistant':
                    continue
                msg = e.get('message', {})
                u = msg.get('usage', {})
                if not u:
                    continue
                tier = model_tier(msg.get('model'))
                if tier not in totals:
                    totals[tier] = {'input': 0, 'cache_write': 0, 'cache_read': 0, 'output': 0}
                t = totals[tier]
                t['input'] += u.get('input_tokens', 0)
                t['cache_write'] += u.get('cache_creation_input_tokens', 0)
                t['cache_read'] += u.get('cache_read_input_tokens', 0)
                t['output'] += u.get('output_tokens', 0)
            except Exception:
                continue
    return {'totals': totals, 'start': start_ts, 'end': end_ts}


def calc_cost(totals: dict[str, dict[str, int]]) -> float:
    cost = 0.0
    for tier, t in totals.items():
        r = PRICING.get(tier, PRICING['sonnet'])
        cost += (t['input'] * r['input'] + t['cache_write'] * r['cache_write']
                 + t['cache_read'] * r['cache_read'] + t['output'] * r['output']) / M
    return cost


def fmt_tokens(n: int) -> str:
    if n >= M:
        return f"{n / M:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.0f}K"
    return str(n)


def main():
    days = 7
    as_json = per_session = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] in ('-d', '--days'):
            days = int(args[i + 1]); i += 2
        elif args[i] == '--json':
            as_json = True; i += 1
        elif args[i] == '--per-session':
            per_session = True; i += 1
        elif args[i] in ('-h', '--help'):
            print("Usage: relaygent cost [-d DAYS] [--json] [--per-session]")
            print("  Estimate API costs from session token data (default: 7 days)")
            sys.exit(0)
        else:
            print(f"Unknown option: {args[i]}", file=sys.stderr); sys.exit(1)
        continue

    sessions = find_sessions(days)
    if not sessions:
        print(json.dumps({"days": days, "sessions": 0, "cost": 0}) if as_json
              else f"No sessions in the last {days} day(s).")
        sys.exit(0)

    grand = {}  # tier -> totals
    session_rows = []
    for s in sessions:
        u = parse_usage(s['path'])
        cost = calc_cost(u['totals'])
        for tier, t in u['totals'].items():
            if tier not in grand:
                grand[tier] = {'input': 0, 'cache_write': 0, 'cache_read': 0, 'output': 0}
            for k in ('input', 'cache_write', 'cache_read', 'output'):
                grand[tier][k] += t[k]
        session_rows.append({'time': s['time'].strftime('%Y-%m-%d %H:%M'), 'cost': cost, 'totals': u['totals']})

    total_cost = calc_cost(grand)
    total_tokens = sum(sum(t.values()) for t in grand.values())

    if as_json:
        print(json.dumps({
            'days': days, 'sessions': len(sessions), 'cost': round(total_cost, 2),
            'tokens': total_tokens, 'by_tier': {k: {**v, 'cost': round(calc_cost({k: v}), 2)} for k, v in grand.items() if sum(v.values()) > 0},
            'per_session': [{'time': r['time'], 'cost': round(r['cost'], 4)} for r in session_rows] if per_session else None,
        }, indent=2))
        sys.exit(0)

    C, G, B, D, Y, N = '\033[0;36m', '\033[0;32m', '\033[1m', '\033[2m', '\033[1;33m', '\033[0m'
    print(f"\n{C}━━━ Cost estimate: last {days} day(s) ━━━{N}\n")
    print(f"  {B}Sessions:{N}  {len(sessions)}")
    print(f"  {B}Tokens:{N}    {fmt_tokens(total_tokens)}")
    print(f"  {B}Total:{N}     {G}${total_cost:.2f}{N}")

    if len(grand) > 0:
        print(f"\n{C}By model tier:{N}")
        for tier in ('opus', 'sonnet', 'haiku'):
            if tier not in grand:
                continue
            t = grand[tier]
            tok = sum(t.values())
            if tok == 0:
                continue
            c = calc_cost({tier: t})
            print(f"  {B}{tier:8s}{N}  ${c:>8.2f}  ({fmt_tokens(tok)} tokens)")
            print(f"  {D}           input {fmt_tokens(t['input'])}, cache write {fmt_tokens(t['cache_write'])}, "
                  f"cache read {fmt_tokens(t['cache_read'])}, output {fmt_tokens(t['output'])}{N}")

    if per_session and session_rows:
        print(f"\n{C}Per session:{N}")
        for r in session_rows:
            print(f"  {D}{r['time']}{N}  ${r['cost']:.2f}")

    print()


if __name__ == '__main__':
    main()
