"""Turn a MIDI file into the home page's steps, as QuartzMIDI's Tap groups them.

Notes struck within the window of a step's first note join it (Score.hpp's kChordWindowNs is 35 ms;
the page uses 60, as its songs' chords have stragglers about 40 ms late).
Output JSON: [[time_s, [[note, velocity, length_s, key_s], ...]], ...], notes folded by octaves into A0..C8.
A note's length runs on under the sustain or sostenuto pedal, so the page needs no pedal of its own; key_s,
how long its key was held down, is there only when the pedal made the sound longer.

python midi2steps.py <in.mid> <out.json> [window_ms]
"""
import json, struct, sys


def read_notes(src):
    """Every note in the file as (start_s, note, velocity, length_s, key_s), sorted, drums left out."""
    data = open(src, 'rb').read()
    assert data[:4] == b'MThd', 'not a MIDI file'
    fmt, ntracks, division = struct.unpack('>HHH', data[8:14])
    assert not division & 0x8000, 'SMPTE time'
    pos = 8 + struct.unpack('>I', data[4:8])[0]
    events = []  # (tick, order, kind, a, b)
    for _ in range(ntracks):
        if data[pos:pos + 4] != b'MTrk':
            break
        ln = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        p, end = pos + 8, min(pos + 8 + ln, len(data))
        pos = pos + 8 + ln
        tick, status = 0, 0

        def var():
            nonlocal p
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
                p += 1
                if c == 0xFF:
                    mtype = data[p]; p += 1
                    mlen = var()
                    if mtype == 0x51:
                        events.append((tick, 0, 'tempo', int.from_bytes(data[p:p + 3], 'big'), 0))
                    p += mlen
                    continue
                if c in (0xF0, 0xF7):
                    p += var()
                    continue
                status = c
            hi, ch = status & 0xF0, status & 0x0F
            if hi in (0xC0, 0xD0):
                a = data[p]; p += 1; b = 0
            else:
                a, b = data[p], data[p + 1]; p += 2
            if ch == 9:
                continue
            if hi == 0x90 and b > 0:
                events.append((tick, 2, 'on', (ch, a), b))
            elif hi == 0x80 or (hi == 0x90 and b == 0):
                events.append((tick, 1, 'off', (ch, a), 0))
            elif hi == 0xB0 and a in (64, 66):  # sustain, sostenuto
                events.append((tick, 1, 'sus' if a == 64 else 'sost', ch, b >= 64))
    events.sort(key=lambda e: (e[0], e[1]))

    # ticks to seconds through the tempo map; a note let go under a pedal rings on until the pedal is let up
    # or the note is struck again, as on a piano
    tempo, last_tick, last_s = 500000, 0, 0.0
    held, ringing, notes = {}, {}, []  # (ch, note) -> [(start, velocity)], ringing's with the key's length
    sus, sost = {}, {}                 # ch -> down; ch -> the notes sostenuto caught

    def end(key, s):
        for t0, v, k in ringing.pop(key, []):
            notes.append((t0, key[1], v, s - t0, k))

    for tick, _, kind, a, b in events:
        s = last_s + (tick - last_tick) * tempo / 1e6 / division
        last_tick, last_s = tick, s
        if kind == 'tempo':
            tempo = a
        elif kind == 'on':
            end(a, s)
            held.setdefault(a, []).append((s, b))
        elif kind == 'off':
            if held.get(a):
                t0, v = held[a].pop(0)
                if sus.get(a[0]) or a in sost.get(a[0], ()):
                    ringing.setdefault(a, []).append((t0, v, s - t0))
                else:
                    notes.append((t0, a[1], v, s - t0, s - t0))
        elif kind == 'sus':
            sus[a] = b
            if not b:
                for key in [k for k in ringing if k[0] == a and k not in sost.get(a, ())]:
                    end(key, s)
        else:  # sostenuto
            if b and not sost.get(a):
                sost[a] = {k for k, v in held.items() if k[0] == a and v}
            elif not b:
                sost[a] = set()
                if not sus.get(a):
                    for key in [k for k in ringing if k[0] == a]:
                        end(key, s)
    for key in list(ringing):
        end(key, last_s)
    for key, vs in held.items():
        for t0, v in vs:
            notes.append((t0, key[1], v, last_s - t0, last_s - t0))
    notes.sort()
    return notes


def fold(n):
    while n < 21: n += 12
    while n > 108: n -= 12
    return n


def to_steps(notes, window=0.06):
    steps = []
    for t, n, v, d, k in notes:
        note = [fold(n), v, round(d, 2)]
        if round(k, 2) < note[2]:
            note.append(round(k, 2))
        if steps and t - steps[-1][0] <= window:
            steps[-1][1].append(note)
        else:
            steps.append([round(t, 3), [note]])
    return steps


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    window = float(sys.argv[3]) / 1000 if len(sys.argv) > 3 else 0.06
    notes = read_notes(src)
    steps = to_steps(notes, window)
    json.dump(steps, open(dst, 'w'), separators=(',', ':'))
    print(len(notes), 'notes', len(steps), 'steps', 'length', round(notes[-1][0], 1), 's')
