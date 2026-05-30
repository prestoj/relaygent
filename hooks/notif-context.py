#!/usr/bin/env python3
import json, os
SEEN_FILE = '/tmp/relaygent-reminder-seen.json'
try:
    seen = set(json.load(open(SEEN_FILE)))
except (FileNotFoundError, json.JSONDecodeError, ValueError):
    seen = set()
seen_added = []
email_ack = 0.0  # Highest email watermark surfaced this turn → durably acked below.
try:
    with open(os.environ['CACHE_FILE']) as f: data = json.load(f)
    parts = []
    for n in data:
        if n.get('type') == 'reminder':
            rid = n.get('id')
            if rid in seen: continue
            if rid is not None: seen_added.append(rid)
            parts.append('REMINDER DUE: "' + n.get('message', '') + '"')
        elif n.get('type') == 'email':
            count = n.get('count', 0)
            try: email_ack = max(email_ack, float(n.get('ack_ts', 0) or 0))
            except (TypeError, ValueError): pass
            noun = 'email' if count == 1 else 'emails'
            msgs = n.get('messages') or n.get('previews') or []
            if msgs:
                m = msgs[0]
                sender = m.get('sender_name') or m.get('from','?')
                line = f'{count} new {noun}: From: {sender} Subject: {m.get("subject","")}'
                ctx = m.get('sender_context')
                if ctx:
                    line += f' [context: {ctx[:160]}]'
                parts.append(line)
            else:
                parts.append(f'{count} new {noun}')
        elif n.get('type') == 'task':
            desc = n.get('description', '?')
            overdue = n.get('overdue', '')
            rb = n.get('runbook', '')
            line = f'TASK DUE: {desc}'
            if overdue:
                line += f' ({overdue})'
            if rb:
                line += f' — runbook: {rb}'
            parts.append(line)
        elif n.get('type') == 'call_speech':
            msgs = n.get('messages', [])
            for m in msgs:
                txt = (m.get('text','') or '').replace('\n',' ')[:300]
                parts.append(f'CALLER: {txt}')
        elif n.get('type') == 'sms':
            count = n.get('count', 0)
            noun = 'SMS' if count == 1 else 'SMS messages'
            msgs = n.get('messages', [])
            if msgs:
                m = msgs[-1]
                body = (m.get('body','') or '')[:80].replace('\n',' ')
                sender = m.get('sender_name') or m.get('from','?')
                line = f'{count} new {noun} from {sender}: {body}'
                ctx = m.get('sender_context')
                if ctx:
                    line += f' [context: {ctx[:160]}]'
                parts.append(line)
            else:
                parts.append(f'{count} new {noun}')
        elif n.get('type') == 'message':
            count = n.get('count', 0)
            src = n.get('source', 'chat')
            if src == 'slack':
                channels = n.get('channels', [])
                previews = []
                for ch in channels[:3]:
                    msgs = ch.get('messages', [])
                    if msgs:
                        m = msgs[-1]
                        txt = (m.get('text') or '')[:60].replace('\n',' ')
                        ch_name = ch.get('name') or '?'
                        sender = m.get('user_name') or m.get('user') or ''
                        prefix = '[#' + ch_name + '] '
                        if sender:
                            prefix += sender + ': '
                        previews.append(prefix + txt)
                summary = str(count) + ' unread Slack' + (': ' + ' | '.join(previews) if previews else ' message(s)')
                parts.append(summary)
            elif src in ('imessage', 'sms'):
                noun = 'iMessage' if src == 'imessage' else 'SMS'
                if count != 1:
                    noun += 's' if src == 'imessage' else ' messages'
                msgs = n.get('messages', [])
                if msgs:
                    m = msgs[-1]
                    body = (m.get('body','') or '')[:80].replace('\n',' ')
                    sender = m.get('sender_name') or m.get('from','?')
                    line = f'{count} new {noun} from {sender}: {body}'
                    ctx = m.get('sender_context')
                    if ctx:
                        line += f' [context: {ctx[:160]}]'
                    parts.append(line)
                else:
                    parts.append(f'{count} new {noun}')
            else:
                parts.append(f'{count} unread chat message(s) — check with read_messages')
    if parts:
        print(' | '.join(parts))
        if seen_added:
            seen |= set(seen_added)
            # Trim to last 200 — keeps file bounded if reminders churn
            trimmed = list(seen)[-200:]
            tmp = SEEN_FILE + '.tmp'
            with open(tmp, 'w') as f: json.dump(trimmed, f)
            os.rename(tmp, SEEN_FILE)
    if email_ack > 0:
        # Consume-ack email: this hook fires post-tool-use, so surfacing here
        # means an agent turn saw the mail. Advance the durable watermark to the
        # exact surfaced ack_ts (never now()), monotonically — email's consume gate.
        ap = os.path.expanduser('~/.relaygent/gmail/.email_ack_ts')
        try: cur = float(open(ap).read().strip() or 0)
        except (OSError, ValueError): cur = 0.0
        if email_ack > cur:
            try:
                os.makedirs(os.path.dirname(ap), exist_ok=True)
                with open(ap, 'w') as f: f.write(f'{email_ack:.3f}')
            except OSError: pass
except Exception as e:
    import sys; print(f'WARNING: notification cache parse error: {e}', file=sys.stderr)
