# -*- coding: utf-8 -*-
import re, io
m = io.open('build/Release/AwesomeWotlkLib.map', encoding='utf-8', errors='replace').read()
# Publics by Address: "  0001:000034a0  004034a0 i ?foo@@"
rows = []
for line in m.splitlines():
    mm = re.match(r'\s*([0-9a-f]{4}):([0-9a-f]{8})\s+([0-9a-f]{8})\s+(.)\s+(\S+)', line)
    if mm:
        rva = int(mm.group(3), 16)
        rows.append((rva, mm.group(5)))
rows.sort()
print('symbols in map:', len(rows))
for target, label in ((0x34B0, 'сегодняшний #134 (704E34B0, база 704E0000)'),
                      (0x2970, 'прошлый #134 28.09 (70C42970, база 70C40000)'),
                      (0x2DC8, 'кадр сэмплера в этом же отчёте (704E2DC8)')):
    prev = None
    for rva, name in rows:
        if rva > target:
            break
        prev = (rva, name)
    nxt = next(((r, n) for r, n in rows if r > target), None)
    print('\nRVA %04X  <- %s' % (target, label))
    print('  落在 символе:', ('%04X  %s' % prev) if prev else 'нет (до первого символа)')
    print('   следующий:   ', ('%04X  %s' % nxt) if nxt else 'нет')
