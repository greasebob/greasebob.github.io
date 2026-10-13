"""Turn a MIDI file into the home page's steps, as QuartzMIDI's Tap groups them.

Notes struck within 35 ms of a step's first note join it (Score.hpp's kChordWindowNs).
Output JSON: [[time_s, [[note, velocity, length_s], ...]], ...], notes folded by octaves into C2..C7.
"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
assert data[:4] == b'MThd'
fmt, ntracks, division = struct.unpack('>HHH', data[8:14])
assert not division & 0x8000
pos = 14
events = []  # (tick, order, kind, a, b)
for ti in range(ntracks):
    assert data[pos:pos + 4] == b'MTrk', data[pos:pos + 4]
    ln = struct.unpack('>I', data[pos + 4:pos + 8])[0]
    p, end = pos + 8, pos + 8 + ln
    pos = end
    tick, status = 0, 0

    def var():
        global p
        v = 0
        while True:
            c = data[p]; p += 1
            v = (v << 7) | (c & 127)
            if not c & 128:
                return v

    while p < end:
        tick += var()
        c = data[p]
        if c & 0x80:
            status = c; p += 1
        if status == 0xFF:
            mtype = data[p]; p += 1
            mlen = var()
            if mtype == 0x51:
                events.append((tick, 0, 'tempo', int.from_bytes(data[p:p + 3], 'big'), 0))
            p += mlen
        elif status in (0xF0, 0xF7):
            p += var()
        else:
            hi = status & 0xF0
            if hi in (0xC0, 0xD0):
                a = data[p]; p += 1; b = 0
            else:
                a, b = data[p], data[p + 1]; p += 2
            if hi == 0x90 and b > 0:
                events.append((tick, 2, 'on', a, b))
            elif hi == 0x80 or (hi == 0x90 and b == 0):
                events.append((tick, 1, 'off', a, 0))
events.sort(key=lambda e: (e[0], e[1]))

# ticks to seconds through the tempo map
tempo, last_tick, last_s = 500000, 0, 0.0
open_notes, notes = {}, []
for tick, _, kind, a, b in events:
    s = last_s + (tick - last_tick) * tempo / 1e6 / division
    last_tick, last_s = tick, s
    if kind == 'tempo':
        tempo = a
    elif kind == 'on':
        open_notes.setdefault(a, []).append((s, b))
    elif open_notes.get(a):
        t0, v = open_notes[a].pop(0)
        notes.append((t0, a, v, s - t0))
notes.sort()


def fold(n):
    while n < 21: n += 12
    while n > 108: n -= 12
    return n


WINDOW = float(sys.argv[3]) / 1000 if len(sys.argv) > 3 else 0.035
steps = []
for t, n, v, d in notes:
    if steps and t - steps[-1][0] <= WINDOW:
        steps[-1][1].append([fold(n), v, round(d, 3)])
    else:
        steps.append([round(t, 3), [[fold(n), v, round(d, 3)]]])
json.dump(steps, open(dst, 'w'), separators=(',', ':'))
print(len(notes), 'notes', len(steps), 'steps', 'range', min(x[1] for x in notes), max(x[1] for x in notes),
      'length', round(notes[-1][0], 1), 's', 'first', [[m[0] for m in s[1]] for s in steps[:12]])
