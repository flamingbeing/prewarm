"""python3 e2e.py <form dir with blank.pdf, fieldmap.json, fields.json, page-N.png>
End to end on the made-up fixture form: fill pages from the field map with known answers, photograph them, scan them
(with a stand-in reader that knows the answers, wrong where told), and check what came out and what got flagged."""
import json, os, sys, tempfile
import cv2, numpy as np
import scan, synth, readers

d = sys.argv[1]
rng = np.random.default_rng(11)
fmap = json.load(open(f'{d}/fieldmap.json', encoding='utf-8')); fields = {f['id']: f for f in json.load(open(f'{d}/fields.json', encoding='utf-8'))}
tpls = scan.templates(d)
truth, photos = {}, []
tmp = tempfile.mkdtemp()
for pg, tpl in enumerate(tpls):
    img = cv2.cvtColor(tpl, cv2.COLOR_GRAY2BGR)
    for fid, loc in fmap['fields'].items():
        if loc['page'] != pg: continue
        f = fields[fid]
        if loc['options']:
            o = str(rng.choice(sorted(loc['options']))); synth.cross(img, loc['options'][o], rng); truth[fid] = o
        elif f['type'] in ('num', 'int', 'time', 'text'):
            v = {'num': f'{rng.uniform(34, 38):.1f}', 'int': str(int(rng.integers(30, 90))), 'time': '07:05', 'text': 'AB123'}[f['type']]
            (_, _, _, _), (x0, y0, x1, y1) = scan.crop_rect(loc['rect'], [], tpl.shape)
            synth.write_text(img, (x0, y0, x1, y1) if f['type'] != 'num' else loc['rect'], v.replace(':', '') if f['type'] == 'time' else v, rng)
            truth[fid] = v
    p = f'{tmp}/p{pg + 1}.jpg'; cv2.imwrite(p, synth.photograph(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), rng)); photos.append(p)
# the stand-in reader is wrong once: a core temperature read differently the second time (so the two reads disagree)
wrong_id = 'prewarm_5_core'
reader = readers.StubReader({k: v for k, v in truth.items()}, {(wrong_id, 1): '37.9'})
scan.main(['--form-dir', d, '--out', f'{tmp}/out', *photos], reader)
got = json.load(open(f'{tmp}/out/scan.json', encoding='utf-8'))
print('pages', got['pages']); print('scan.json at', f'{tmp}/out/scan.json')
bad = 0
for fid, e in got['fields'].items():
    t = truth.get(fid)
    sure = not e['flags']
    ok = t is None or str(e['value']) == str(t) or (e['value'] is not None and float(e['value']) == float(t) if t.replace('.', '').isdigit() and e['value'] not in (None, 'NA') else False)
    if e['kind'] == 'text' and fields[fid]['type'] in scan.NEVER_SEND: ok = e['value'] is None and e['flags']
    if not ok and sure: bad += 1; print('SILENT ERROR', fid, e['value'], 'truth', t)
    if e['flags']: print('flagged', fid, e['value'], e['flags'])
print(f'{len(got["fields"])} fields, silent errors: {bad}')

# ---- no API: export the crops, read them (two independent readings), carry on; or type everything in
import os
crops = f'{tmp}/crops'
scan.main(['--form-dir', d, '--out', f'{tmp}/o1', '--export-crops', crops, *photos])
man = json.load(open(f'{crops}/manifest.json', encoding='utf-8'))
sheets = sorted(f for f in os.listdir(crops) if f[0] in 'ab' and f.endswith('.png') and f[1] == '-')
assert man and sheets and all(os.path.exists(f'{crops}/{k}.png') for k in man), 'crops, manifest and sheets written'
assert all(m['allowed'] for m in man.values()), 'each cell says what it can be'
numeric = {k: v for k, v in truth.items() if k in man}
ra = dict(numeric); rb = dict(numeric)
some = sorted(numeric)[0]; other = sorted(numeric)[-1]
rb[some] = '99.9'                                  # the second reading disagrees about one cell
ra[other] = {'text': numeric[other], 'legible': False}  # the first reader is unsure about another
json.dump(ra, open(f'{tmp}/ra.json', 'w')); json.dump(rb, open(f'{tmp}/rb.json', 'w'))
scan.main(['--form-dir', d, '--out', f'{tmp}/o2', '--readings', f'{tmp}/ra.json', '--readings2', f'{tmp}/rb.json', *photos])
g2 = json.load(open(f'{tmp}/o2/scan.json', encoding='utf-8'))['fields']
assert 'two reads disagree' in g2[some]['flags'], g2[some]
assert 'hard to read' in g2[other]['flags'], g2[other]
agreed = [k for k in numeric if k not in (some, other) and fields[k]['type'] in ('num', 'int', 'time')]
assert agreed and all(str(g2[k]['value']) == str(numeric[k]) or float(g2[k]['value']) == float(numeric[k].replace(':', '')) if ':' not in numeric[k] else True for k in agreed)
scan.main(['--form-dir', d, '--out', f'{tmp}/o3', '--no-read', *photos])
g3 = json.load(open(f'{tmp}/o3/scan.json', encoding='utf-8'))['fields']
assert all(g3[k]['value'] is None and 'type this in (not read)' in g3[k]['flags'] for k in man), 'every written cell is left to be typed'
ticks_same = [k for k, e in got['fields'].items() if e['kind'] == 'tick']
assert all(g3[k]['value'] == got['fields'][k]['value'] for k in ticks_same), 'ticks are read the same without a reader'
print('no-API modes: ok')
sys.exit(1 if bad else 0)
