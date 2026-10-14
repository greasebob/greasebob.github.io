"""Turn a folder of MIDI files into the home page's songs: songs/<n>.json each, and songs/index.json naming them.

The page picks one at random, and another when it ends. Copies (the same bytes, or the same name) are kept once,
and the songs in DROP and all but one of each group in REPEATS are left out.

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
    'Tango Piano by Sangah Noona - Full Studio Album qUeABWUmhQ0-AudioTrimmer.com': 'Tango Piano by Sangah Noona - Full Studio Album',
}


# Left out, as he asked (2026-10-14): Interstellar in every version, the overplayed hits, nursery and novelty
# tunes, and MIDIs with no real name. Matched on the lower-cased title.
DROP = [
    r'interstellar',
    r'\bexperience\b', r'nuvole bianche', r'divenire', r'^fly \(akmigone\)', r'i giorni', r'le onde',
    r'^night \(akmigone\)', r'oltremare', r'comptine', r'clair de lune', r'moonlight', r'fur e', r'nocturne op\.? ?9 no\.? ?2',
    r'gnossienne',
    r'twinkle', r'mary had a little lamb', r'happy birthday', r'jingle bells', r'meme medley', r'lihat kebunku', r'^rush e',
    r'^(first midi i made|lol|how|woo|midi export|minus one|medley|damned bo2)$',
]
# One piece played from the same notes in several files: only the fullest (the most notes) is kept. Different
# arrangements (Howl's Moving Castle, Mia & Sebastian, Unravel, Vogel im Kafig, Schindler's List and more, whose
# files differ in length and opening) are different music and all stay.
REPEATS = [
    r'hungarian[ -]rhapsody|friska', r'^(?!.*(jazz|winter wind)).*campanella', r'liebestra',
    r'ballade ?\.?no\.? ?1(?!\d)', r'ballade ?\.?no\.? ?3', r'25 no\.? ?6', r'nocturne in c sharp minor',
    r'prelude.?in.?e.?minor', r'batman', r'light of the seven', r'la morocha',
]


files = sorted(os.path.join(r, f) for r, _, fs in os.walk(src) for f in fs if f.lower().endswith(('.mid', '.midi')))
seen_bytes, seen_names, songs, skipped = set(), set(), [], []
for path in files:
    raw = open(path, 'rb').read()
    digest, name = hashlib.md5(raw).hexdigest(), title(path)
    if digest in seen_bytes or name.lower() in seen_names:
        continue
    seen_bytes.add(digest)
    if any(re.search(p, name.lower()) for p in DROP):
        skipped.append((name, 'left out')); continue
    try:
        notes = read_notes(path)
    except Exception as e:
        skipped.append((name, 'unreadable: %s' % e)); continue
    steps = to_steps(notes)
    if len(steps) < 60:
        skipped.append((name, '%d steps' % len(steps))); continue
    seen_names.add(name.lower())
    songs.append((name, steps, len(notes)))
for p in REPEATS:
    group = [s for s in songs if re.search(p, s[0].lower())]
    keep = max(group, key=lambda s: s[2], default=None)
    for s in group:
        if s is not keep:
            songs.remove(s)
            skipped.append((s[0], 'a repeat of ' + keep[0]))
index = []
for name, steps, _ in songs:
    out = '%d.json' % len(index)
    json.dump(steps, open(os.path.join(dst, out), 'w'), separators=(',', ':'))
    index.append({'name': name, 'file': out})
json.dump(index, open(os.path.join(dst, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
size = sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))
print(len(files), 'files,', len(index), 'songs,', round(size / 1e6, 1), 'MB')
for name, why in skipped:
    print('skipped', name, '-', why)
