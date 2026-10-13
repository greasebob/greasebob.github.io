"""Turn a folder of MIDI files into the home page's songs: songs/<n>.json each, and songs/index.json naming them.

The page picks one at random, and another when it ends. Copies (the same bytes, or the same name) are kept once.

python build-songs.py <midi folder> <site>/songs
"""
import hashlib, json, os, re, sys

from midi2steps import read_notes, to_steps

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in os.listdir(dst):
    if f.endswith('.json'):
        os.remove(os.path.join(dst, f))


def title(path):
    t = os.path.splitext(os.path.basename(path))[0]
    t = re.sub(r'^(output_|solo_)?[0-9a-f]{8}_', '', t)
    t = re.sub(r'^(output_|solo_)', '', t)
    t = re.sub(r'\s*\(\d+\)$', '', t)
    t = re.sub(r'_[A-Za-z0-9-]{11}$', '', t)  # a YouTube id left at the end
    t = re.sub(r'\s+', ' ', t.replace('_', ' ')).strip()
    t = FIXES.get(t, t)
    t = re.sub(r'^OUTPUT-\s*', '', t)
    return re.sub(r'\s+MIDI$', '', t)


# names the rules above can't mend: a file's own typo, a YouTube id with an underscore in it
FIXES = {
    'ans Zimmer - Interstellar EPIC PIANO SUITE (12 min cover)': 'Hans Zimmer - Interstellar EPIC PIANO SUITE (12 min cover)',
    'unravel - tokyo ghoul animenz NwyGzNBim 8': 'unravel - tokyo ghoul animenz',
}


files = sorted(os.path.join(r, f) for r, _, fs in os.walk(src) for f in fs if f.lower().endswith(('.mid', '.midi')))
seen_bytes, seen_names, index, skipped = set(), set(), [], []
for path in files:
    raw = open(path, 'rb').read()
    digest, name = hashlib.md5(raw).hexdigest(), title(path)
    if digest in seen_bytes or name.lower() in seen_names:
        continue
    seen_bytes.add(digest)
    try:
        notes = read_notes(path)
    except Exception as e:
        skipped.append((name, 'unreadable: %s' % e)); continue
    steps = to_steps(notes)
    if len(steps) < 60:
        skipped.append((name, '%d steps' % len(steps))); continue
    seen_names.add(name.lower())
    out = '%d.json' % len(index)
    json.dump(steps, open(os.path.join(dst, out), 'w'), separators=(',', ':'))
    index.append({'name': name, 'file': out})
json.dump(index, open(os.path.join(dst, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
size = sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))
print(len(files), 'files,', len(index), 'songs,', round(size / 1e6, 1), 'MB')
for name, why in skipped:
    print('skipped', name, '-', why)
