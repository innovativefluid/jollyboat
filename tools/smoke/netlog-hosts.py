#!/usr/bin/env python3
"""Summarise a Chromium net log: every host the app resolved or connected to, and every URL it requested.

usage: tools/smoke/netlog-hosts.py <netlog.json>
"""
import json
import re
import sys
from collections import Counter

log = json.load(open(sys.argv[1]))
types = {v: k for k, v in log['constants']['logEventTypes'].items()}
hosts, urls, udp = Counter(), Counter(), Counter()

for e in log['events']:
    t = types.get(e.get('type'), '')
    p = e.get('params') or {}
    if t in ('HOST_RESOLVER_DNS_TASK', 'HOST_RESOLVER_MANAGER_REQUEST', 'HOST_RESOLVER_MANAGER_JOB') and 'host' in p:
        hosts[re.sub(r'^https?://', '', str(p['host']))] += 1
    if t in ('URL_REQUEST_START_JOB', 'CORS_REQUEST') and 'url' in p:
        urls[re.sub(r'\?.*', '', p['url'])] += 1
    if t in ('TCP_CONNECT', 'TCP_CONNECT_ATTEMPT') and 'address' in p:
        hosts['tcp ' + p['address']] += 1
    if t.startswith('UDP_') and 'address' in p:
        udp[p['address']] += 1

print('== hosts / connects'); [print(f'{n:4} {h}') for h, n in hosts.most_common()]
print('== urls'); [print(f'{n:4} {u}') for u, n in urls.most_common()]
print('== udp'); [print(f'{n:4} {u}') for u, n in udp.most_common()]
