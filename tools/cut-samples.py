"""Cut a small sample set for the home page from P2Piano's Salamander SF3.

One velocity layer (v10, 73-88), every sampled root from C2 to C7, left and right
Ogg streams joined to stereo, 3 s long with a fade, as MP3 named by MIDI note.
"""
import os, struct, subprocess, sys, tempfile

src, out = sys.argv[1], sys.argv[2]
LAYER = 'v10'
LO, HI = 21, 108
FFMPEG = sys.argv[3]
os.makedirs(out, exist_ok=True)
data = open(src, 'rb').read()


def chunks(start, end):
    pos = start
    while pos < end:
        cid, size = struct.unpack('<4sI', data[pos:pos + 8])
        yield cid, size, pos + 8
        pos += 8 + size + (size & 1)


raw = {}
for cid, size, pos in chunks(12, len(data)):
    kind = data[pos:pos + 4]
    for sid, ssize, spos in chunks(pos + 4, pos + size):
        raw[(kind, sid)] = (spos, ssize)
smpl0 = raw[(b'sdta', b'smpl')][0]
spos, ssize = raw[(b'pdta', b'shdr')]
by_name = {}
for i in range(0, ssize - 46, 46):
    r = data[spos + i:spos + i + 46]
    name = r[:20].split(b'\0')[0].decode('latin1')
    start, end, _, _, rate, pitch, corr, link, stype = struct.unpack('<IIIIIBbHH', r[20:46])
    by_name[name] = (start, end, pitch, corr)

roots = sorted({v[2] for k, v in by_name.items() if k.endswith(f'{LAYER}_L')})
roots = [r for r in roots if LO - 2 <= r <= HI + 2]
tmp = tempfile.mkdtemp()
for root in roots:
    name = next(k[:-2] for k, v in by_name.items() if k.endswith(f'{LAYER}_L') and v[2] == root)
    files = []
    for side in 'LR':
        start, end, pitch, corr = by_name[f'{name}_{side}']
        assert corr == 0, (name, corr)
        p = os.path.join(tmp, f'{root}{side}.ogg')
        open(p, 'wb').write(data[smpl0 + start:smpl0 + end])
        files.append(p)
    dst = os.path.join(out, f'{root}.mp3')
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', files[0], '-i', files[1],
                    '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo,atrim=0:3,afade=t=out:st=2.2:d=0.8',
                    '-c:a', 'libmp3lame', '-q:a', '7', dst], check=True)
    print(root, name, os.path.getsize(dst))
