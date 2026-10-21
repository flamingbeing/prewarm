"""The study computer's reader: python watch.py  (run on Firetop, next to inbox.py).

Every received scan folder (SCAN_INBOX/<scan>/page-<n>.jpg|png, from inbox.py) with photos not read yet that has stopped
changing is read with scan.py --reader ollama (a local vision model: nothing leaves this computer), and the values and flags
it found go to Firestore as scanImports/<scan> in prewarm-study (status "pending"), with the Subject ID typed on the phone
and each value's form page and place on it (coordinates: the app cuts the crop from the phone's own copy). An admin
approves them in the app before anything reaches a patient (firestore.rules). Photos, crops and the scan.json stay in the
folder: only values, flags and coordinates are sent.

Rounds: photos that arrive after a folder was read (a retake, a late page) are read on their own and filed as
scanImports/<scan>-2, -3 ... (an import an admin may be reviewing is never overwritten).
status.json in the folder is what the phone sees through inbox.py's status route: per photo (by the phone's page number)
which page the study computer found it to be, its alignment score, whether it was accepted (else why: a retake request),
how many values and flags it gave, and which import it went into; every few minutes the review state of each pending
import (approved / rejected / deleted) is copied in. Numbers and states only, never values.

Needs: gcloud signed in as the owner (the REST call uses its token, which bypasses the rules: no app user can create an
import), the form data from setup-form.sh (SCAN_FORM_DIR), Ollama running.
Settings (environment): SCAN_INBOX (default inbox), SCAN_FORM_DIR (default form-data), SCAN_PROJECT (default prewarm-study),
SCAN_QUIET (seconds a folder must be unchanged, default 90), SCAN_EVERY (poll seconds, default 30), SCAN_MODEL.
Three failed tries on the same photos write import-error.txt; a new upload from the phone (inbox.py) removes it and the
folder is tried again. Nothing here is run on a phone or in the cloud.
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = re.compile(r'^page-([1-9]|1[0-4]|x)\.(jpg|png)$')
MAX_TRIES = 3
REVIEW_EVERY = 300       # seconds between looks at the review state of pending imports
REVIEW_DAYS = 14         # stop looking after this many days


def photos(folder):
    """-> [(label, path)] sorted by label (x last)"""
    out = [(m.group(1), os.path.join(folder, f)) for f in os.listdir(folder) if (m := PAGE.match(f))]
    return sorted(out, key=lambda x: (x[0] == 'x', int(x[0]) if x[0] != 'x' else 0))


def mtime(path):
    return os.stat(path).st_mtime_ns


def load_status(folder):
    """status.json, or a fresh one. A folder imported before rounds existed (imported.json, no status.json) counts as read."""
    try: return json.load(open(os.path.join(folder, 'status.json')))
    except (OSError, ValueError): pass
    st = {'state': 'received', 'read': {}, 'pages': {}, 'imports': []}
    if os.path.exists(os.path.join(folder, 'imported.json')):
        st['read'] = {l: mtime(p) for l, p in photos(folder)}
        st['state'] = 'read'; st['imports'] = [{'id': os.path.basename(os.path.normpath(folder)), 'review': 'pending'}]
    return st


def save_status(folder, st):
    st['at'] = int(time.time())
    tmp = os.path.join(folder, 'status.json.part')
    json.dump(st, open(tmp, 'w')); os.replace(tmp, os.path.join(folder, 'status.json'))


def unread(folder, st=None):
    """photos new or replaced since the last read: [(label, path)]"""
    st = st or load_status(folder)
    return [(l, p) for l, p in photos(folder) if st['read'].get(l) != mtime(p)]


def ready(folder, now, quiet):
    """A folder is ready when it has photos not read yet, no error stop, and nothing changed for `quiet` seconds."""
    if not os.path.isdir(folder) or not photos(folder): return False
    if os.path.exists(os.path.join(folder, 'import-error.txt')) or not unread(folder): return False
    newest = max(os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder) if PAGE.match(f) or f == 'meta.json')
    return now - newest >= quiet


SUBJECT = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$')   # the Subject IDs inbox.py takes


def box_of(b):
    """a field's place on its page {x, y, w, h} (fractions), or None if it is not one"""
    if not isinstance(b, dict): return None
    try: out = {k: round(float(b[k]), 4) for k in ('x', 'y', 'w', 'h')}
    except (KeyError, TypeError, ValueError): return None
    return out if all(0 <= v <= 1 for v in out.values()) and out['w'] > 0 and out['h'] > 0 else None


def build_doc(scan, scan_json, now_ms, subject=''):
    """scan.json -> the import document. Values, flags, the form page and the field's place on it (coordinates) only:
    no crops, no photos, no labels. `subject` is the Subject ID typed on the phone (meta.json), so the app can pick the patient."""
    fields = {}
    for fid, e in scan_json.get('fields', {}).items():
        v = e.get('value')
        flags = [str(x)[:200] for x in e.get('flags', [])][:10]
        if (v is None or str(v) == '') and not flags: continue
        fields[fid] = {'v': '' if v is None else str(v)[:200], 'flags': flags}
        if isinstance(e.get('page'), int) and 1 <= e['page'] <= 14: fields[fid]['page'] = e['page']
        if (b := box_of(e.get('box'))): fields[fid]['box'] = b
    pages = [{'page': p.get('page'), 'accepted': bool(p.get('accepted')), 'score': p.get('score')} for p in scan_json.get('pages', [])]
    doc = {'scan': scan, 'createdAt': now_ms, 'status': 'pending', 'pages': pages, 'fields': fields}
    if isinstance(subject, str) and SUBJECT.match(subject.strip()): doc['subject'] = subject.strip()
    return doc


def subject_of(folder):
    """the Subject ID sent with the photos (inbox.py keeps it in meta.json), or ''"""
    try: return str(json.load(open(os.path.join(folder, 'meta.json'))).get('subject') or '')
    except (OSError, ValueError, AttributeError): return ''


def fs_value(x):
    """a Python value -> Firestore REST typed value"""
    if x is None: return {'nullValue': None}
    if isinstance(x, bool): return {'booleanValue': x}
    if isinstance(x, int): return {'integerValue': str(x)}
    if isinstance(x, float): return {'doubleValue': x}
    if isinstance(x, str): return {'stringValue': x}
    if isinstance(x, list): return {'arrayValue': {'values': [fs_value(i) for i in x]}}
    if isinstance(x, dict): return {'mapValue': {'fields': {k: fs_value(v) for k, v in x.items()}}}
    raise TypeError(type(x))


def token():
    return subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, check=True, shell=(os.name == 'nt')).stdout.strip()


def post(project, scan, doc, tok):
    """create scanImports/<scan> (409 if it exists: never overwrite an import an admin may be reviewing)"""
    url = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/scanImports?documentId={scan}'
    body = json.dumps({'fields': {k: fs_value(v) for k, v in doc.items()}}).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try: urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 409: return 'exists'
        raise RuntimeError(f'Firestore said {e.code}')
    return 'created'


def run_scan(folder, form_dir, model=None, todo=None):
    """scan.py on the folder's photos (or just `todo`) -> its scan.json (dict). The phone's page numbers are a hint:
    scan.py keeps them unless another page lines up clearly better (a burst shot out of order)."""
    ph = todo if todo is not None else photos(folder)
    cmd = [sys.executable, os.path.join(HERE, 'scan.py'), '--form-dir', form_dir, '--out', os.path.join(folder, 'read'), '--reader', 'ollama',
           '--hint-pages', ','.join(l for l, _ in ph)]
    if model: cmd += ['--model', model]
    subprocess.run(cmd + [p for _, p in ph], check=True, capture_output=True, text=True)
    return json.load(open(os.path.join(folder, 'read', 'scan.json'), encoding='utf-8'))


def page_status(sj, todo, import_id, marks):
    """scan.json + the photos read -> {label: {page, score, accepted, why?, values, flagged, import, mtime}}"""
    by_photo = {os.path.basename(p): (l, p) for l, p in todo}
    out = {}
    for pg in sj.get('pages', []):
        if pg.get('photo') not in by_photo: continue
        label, path = by_photo[pg['photo']]
        n = pg.get('page')
        vals = [e for e in sj.get('fields', {}).values() if e.get('page') == n] if pg.get('accepted') else []
        e = {'page': n, 'score': pg.get('score'), 'accepted': bool(pg.get('accepted')), 'import': import_id, 'mtime': marks[label],
             'values': sum(1 for v in vals if v.get('value') not in (None, '')), 'flagged': sum(1 for v in vals if v.get('flags'))}
        if not e['accepted']:
            e['why'] = f'Did not line up with the form (score {pg.get("score", 0):.2f}): retake it flat, whole page in view.'
        out[label] = e
    taken = {}
    for label, e in sorted(out.items(), key=lambda x: -(x[1]['score'] or 0)):
        if e['accepted'] and e['page'] in taken and taken[e['page']] != label:
            e['why'] = f'Looks like page {e["page"]} again (also sent as page {taken[e["page"]]}).'
        taken.setdefault(e['page'], label)
    return out


def process(folder, scan, form_dir, project, read=run_scan, send=post, get_token=token, model=None):
    """read the folder's unread photos and file their import. Returns 'created' / 'exists'. Raises on failure.
    The first read is scanImports/<scan>, later ones <scan>-2, -3 ..."""
    st = load_status(folder); todo = unread(folder, st)
    import_id = scan if not st['imports'] else f'{scan}-{len(st["imports"]) + 1}'
    marks = {l: mtime(p) for l, p in todo}                     # a photo replaced while it is read is read again next time
    st['state'] = 'reading'; st['reading'] = [l for l, _ in todo]; save_status(folder, st)
    try:
        sj = read(folder, form_dir, model, todo)
        doc = build_doc(scan, sj, int(time.time() * 1000), subject_of(folder))
        if not doc['fields'] and not any(p['accepted'] for p in doc['pages']):
            doc['note'] = 'No photo lined up: retake and send again.'
        out = send(project, import_id, doc, get_token())
    except Exception:
        st = load_status(folder); st['state'] = 'received'; st.pop('reading', None); save_status(folder, st)
        raise
    st = load_status(folder)
    st['pages'].update(page_status(sj, todo, import_id, marks))
    st['read'].update(marks)
    st['imports'].append({'id': import_id, 'result': out, 'review': 'pending', 'values': len(doc['fields'])})
    st['state'] = 'read'; st.pop('reading', None); save_status(folder, st)
    json.dump({'at': int(time.time()), 'result': out, 'values': len(doc['fields']), 'id': import_id}, open(os.path.join(folder, 'imported.json'), 'w'))
    return out


def get_review(project, import_id, tok):
    """the review state of one import: pending / approved / rejected, or deleted when the admin removed it"""
    url = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/scanImports/{import_id}?mask.fieldPaths=status'
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok})
    try: doc = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        if e.code == 404: return 'deleted'
        raise RuntimeError(f'Firestore said {e.code}')
    return doc.get('fields', {}).get('status', {}).get('stringValue', 'pending')


def reviews(folder, project, get=get_review, get_token=token, now=None):
    """copy the review state of the folder's pending imports into status.json; True if anything changed"""
    st = load_status(folder); now = now or time.time()
    pend = [i for i in st['imports'] if i.get('review', 'pending') == 'pending']
    if not pend or now - st.get('at', now) > REVIEW_DAYS * 86400: return False
    tok, changed = get_token(), False
    for i in pend:
        r = get(project, i['id'], tok)
        if r != 'pending': i['review'] = r; i['reviewedAt'] = int(now); changed = True
    if changed: save_status(folder, st)
    return changed


def main():
    inbox = os.environ.get('SCAN_INBOX', 'inbox'); form = os.environ.get('SCAN_FORM_DIR', 'form-data')
    project = os.environ.get('SCAN_PROJECT', 'prewarm-study'); quiet = float(os.environ.get('SCAN_QUIET', '90'))
    every = float(os.environ.get('SCAN_EVERY', '30')); tries = {}; last_review = 0
    print(f'scan reader: inbox {os.path.abspath(inbox)}, form {os.path.abspath(form)}, project {project}', file=sys.stderr)
    for scan in os.listdir(inbox) if os.path.isdir(inbox) else []:   # a read cut short by a restart is waiting again
        folder = os.path.join(inbox, scan)
        if os.path.exists(os.path.join(folder, 'status.json')) and (st := load_status(folder)).get('state') == 'reading':
            st['state'] = 'received'; st.pop('reading', None); save_status(folder, st)
    while True:
        look = time.time() - last_review >= REVIEW_EVERY
        if look: last_review = time.time()
        for scan in sorted(os.listdir(inbox)) if os.path.isdir(inbox) else []:
            folder = os.path.join(inbox, scan)
            if not os.path.isdir(folder): continue
            if look:
                try: reviews(folder, project)
                except Exception as e: print(scan[:8], 'review state', type(e).__name__, file=sys.stderr)
            if not ready(folder, time.time(), quiet): continue
            key = (scan, tuple((l, mtime(p)) for l, p in unread(folder)))   # tries count per set of photos: a retake starts again
            if tries.get(key, 0) >= MAX_TRIES: continue
            tries[key] = tries.get(key, 0) + 1
            try: print(scan[:8], process(folder, scan, form, project, model=os.environ.get('SCAN_MODEL')), file=sys.stderr)
            except Exception as e:      # never print values or paths from the scan; the type and a short message only
                msg = f'{type(e).__name__}: {str(e)[:300]}'
                print(scan[:8], 'failed', msg, file=sys.stderr)
                if tries[key] >= MAX_TRIES: open(os.path.join(folder, 'import-error.txt'), 'w').write(msg)
        time.sleep(every)


if __name__ == '__main__':
    main()
