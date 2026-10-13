"""Cut the home page's samples from P2Piano's Salamander SF3.

Four velocity layers, so a soft note has the soft hammer's mellow tone and not only less volume:
v4 for velocities 1-48, v8 49-72, v12 73-100 and v16 101-127 (the bank's own ranges, merged in pairs).
Every sampled root from A0 to C8 (a minor third apart), left and right Ogg streams joined to stereo,
4 s long with a fade, as MP3 at LAME's V4, in notes/<layer>/<midi note>.mp3.

python cut-samples.py <sf3> <site>/notes <ffmpeg>
"""
import os, struct, subprocess, sys, tempfile

src, out, FFMPEG = sys.argv[1], sys.argv[2], sys.argv[3]
LAYERS = ['v4', 'v8', 'v12', 'v16']
LO, HI = 21, 108
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

tmp = tempfile.mkdtemp()
total = 0
for layer in LAYERS:
    os.makedirs(os.path.join(out, layer), exist_ok=True)
    roots = sorted({v[2] for k, v in by_name.items() if k.endswith(f'{layer}_L')})
    roots = [r for r in roots if LO - 2 <= r <= HI + 2]
    for root in roots:
        name = next(k[:-2] for k, v in by_name.items() if k.endswith(f'{layer}_L') and v[2] == root)
        files = []
        for side in 'LR':
            start, end, pitch, corr = by_name[f'{name}_{side}']
            assert corr == 0, (name, corr)
            p = os.path.join(tmp, f'{layer}{root}{side}.ogg')
            open(p, 'wb').write(data[smpl0 + start:smpl0 + end])
            files.append(p)
        dst = os.path.join(out, layer, f'{root}.mp3')
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', files[0], '-i', files[1],
                        '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo,atrim=0:4,afade=t=out:st=3:d=1',
                        '-c:a', 'libmp3lame', '-q:a', '4', dst], check=True)
        total += os.path.getsize(dst)
    print(layer, len(roots), 'roots')
print(round(total / 1e6, 2), 'MB')
