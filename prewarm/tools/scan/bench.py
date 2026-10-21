"""How well does a reader read the handwritten crops? Run it on crops whose true values a person has confirmed.

python3 bench.py --form-dir form-data --crops crops/ --truth pt01.reviewed.json [--reader ollama] [--model gemma4:12b]

--crops is a folder written by `scan.py --export-crops` (one <field id>.png per cell); --truth is the reviewed file from
review.html ({"fields": {id: value}}) or a readings file ({id: text}). Each crop is read twice, as scan.py does, and sorted:
  right    both reads agree, no flag, and the value is the confirmed one
  flagged  a flag (disagree, hard to read, out of range...) sends it to the person: caught, whatever the value
  WRONG    no flag but the value is not the confirmed one: the error the review screen could miss
Prints counts and field ids only (never values), so the output can be pasted anywhere."""
import argparse, glob, json, os, sys, time
import cv2
import plausible, readers, scan


def main(argv=None, reader=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--form-dir', required=True); ap.add_argument('--crops', required=True); ap.add_argument('--truth', required=True)
    ap.add_argument('--reader', choices=['claude', 'ollama'], default='ollama'); ap.add_argument('--model')
    ap.add_argument('--key-file'); ap.add_argument('--limit', type=int, help='only the first N crops (a quick look)')
    a = ap.parse_args(argv)
    fields = {f['id']: f for f in json.load(open(f'{a.form_dir}/fields.json', encoding='utf-8'))}
    t = json.load(open(a.truth, encoding='utf-8'))
    t = t.get('fields', t)
    truth = {k: (v.get('text', '') if isinstance(v, dict) else str(v)) for k, v in t.items()}
    reader = reader or (readers.OllamaReader(a.model) if a.reader == 'ollama' else readers.AnthropicReader(a.model, key_file=a.key_file))
    paths = sorted(p for p in glob.glob(os.path.join(a.crops, '*.png'))
                   if os.path.basename(p)[:-4] in fields and os.path.basename(p)[:-4] in truth)[:a.limit]
    if not paths:
        sys.exit('no crops with both a field and a confirmed value')
    out = {'right': [], 'flagged': [], 'WRONG': []}
    t0 = time.time()
    for p in paths:
        fid = os.path.basename(p)[:-4]; f = fields[fid]
        reads = scan.read_cell(reader, f, cv2.imread(p, cv2.IMREAD_GRAYSCALE))
        vals = [plausible.clean(f, r['text']) for r in reads]
        flagged = (not all(r['legible'] for r in reads) or str(vals[0][0]) != str(vals[1][0]) or vals[0][1]
                   or vals[0][0] is None)
        want = plausible.clean(f, truth[fid])[0]
        out['flagged' if flagged else 'right' if str(vals[0][0]) == str(want) else 'WRONG'].append(fid)
    n, s = len(paths), time.time() - t0
    print(f'{n} crops, {s:.0f} s ({s / n:.1f} s each), {type(reader).__name__} {getattr(reader, "model", "")}')
    for k, v in out.items():
        print(f'  {k:8} {len(v):4}  {100 * len(v) / n:5.1f} %')
    if out['WRONG']:
        print('  WRONG fields:', ', '.join(out['WRONG']))
    return out


if __name__ == '__main__':
    main()
