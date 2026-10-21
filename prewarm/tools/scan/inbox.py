"""The study computer's side of the Scan pages upload: python inbox.py  (run on Firetop, bound to this computer only).

The Worker (worker/scan.js) passes the phones' photos here through Cloudflare's tunnel; Access on this address lets in only the
Worker's service token. Photos are written to SCAN_INBOX/<scan>/page-<n>.jpg (or .png) with a meta.json (who sent, when, the
Subject ID typed on the phone). Nothing is read, aligned or sent anywhere from here: watch.py reads the folder.

  POST /scan-api/upload/<scan>/<page>   body = the photo (JPEG or PNG), page 1-14 or x;
                                        header X-Scan-Subject (optional)                  -> {"ok": true, "pages": [...]}
  GET  /scan-api/status/<scan>          -> {"scan", "pages", "state", "page": {label: {"state", ...}}}
     state: received (waiting to be read) / reading / read / approved / failed; per page: received / reading / read /
     retake (with "why") / approved / rejected, plus the page the study computer found it to be ("page"), its score and
     how many values and flags it gave. From watch.py's status.json; numbers and states only, never values.

Settings (environment): SCAN_INBOX (folder, default ./inbox), SCAN_PORT (default 8788).
Scans and photos stay out of git. A phone can resend a page: it replaces the earlier one.
"""
import json, os, re, sys, tempfile, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_PHOTO = 12 * 1024 * 1024
MAX_PAGES = 20            # files in one scan (pages 1-14 and x, either format, with room for retakes)
SCAN_ID = re.compile(r'^[A-Za-z0-9-]{8,64}$')
PAGE = re.compile(r'^(?:[1-9]|1[0-4]|x)$')
SUBJECT = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$')


def kind(body):
    if body[:3] == b'\xff\xd8\xff': return 'jpg'
    if body[:8] == b'\x89PNG\r\n\x1a\n': return 'png'
    return None


def pages_of(folder):
    out = []
    for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        m = re.fullmatch(r'page-([1-9]|1[0-4]|x)\.(jpg|png)', f)
        if m: out.append(m.group(1))
    return out


def upload(inbox, scan, page, body, user, subject=''):
    """-> (status, json)"""
    if not body: return 400, {'error': 'Empty photo.'}
    if subject and not SUBJECT.match(subject): return 400, {'error': 'That Subject ID has characters it cannot take.'}
    if len(body) > MAX_PHOTO: return 413, {'error': 'Photo too big.'}
    ext = kind(body)
    if not ext: return 415, {'error': 'Not a JPEG or PNG photo.'}
    folder = os.path.join(inbox, scan)
    os.makedirs(folder, exist_ok=True)
    have = pages_of(folder)
    if page not in have and len(have) >= MAX_PAGES: return 409, {'error': 'Too many pages in this scan.'}
    fd, tmp = tempfile.mkstemp(dir=folder, suffix='.part')
    with os.fdopen(fd, 'wb') as f: f.write(body)
    for e in ('jpg', 'png'):                      # a resend replaces the page, whatever format it was
        old = os.path.join(folder, f'page-{page}.{e}')
        if os.path.exists(old): os.remove(old)
    os.replace(tmp, os.path.join(folder, f'page-{page}.{ext}'))
    meta_path = os.path.join(folder, 'meta.json')
    try: meta = json.load(open(meta_path))
    except (OSError, ValueError): meta = {'created': int(time.time()), 'by': user[:200]}
    meta['updated'] = int(time.time())
    if subject: meta['subject'] = subject
    json.dump(meta, open(meta_path, 'w'))
    err = os.path.join(folder, 'import-error.txt')      # a new photo (a retake) gets the reader trying again
    if os.path.exists(err): os.remove(err)
    return 200, {'ok': True, 'pages': pages_of(folder)}


def status(inbox, scan):
    folder = os.path.join(inbox, scan)
    if not os.path.isdir(folder): return 404, {'error': 'No such scan.'}
    try: st = json.load(open(os.path.join(folder, 'status.json')))
    except (OSError, ValueError): st = {}
    legacy = not st and os.path.exists(os.path.join(folder, 'imported.json'))   # read before status.json existed
    reviews = {i.get('id'): i.get('review', 'pending') for i in st.get('imports', [])}
    reading = st.get('state') == 'reading'
    out = {}
    for label in pages_of(folder):
        f = next(os.path.join(folder, f'page-{label}.{e}') for e in ('jpg', 'png') if os.path.exists(os.path.join(folder, f'page-{label}.{e}')))
        e = st.get('pages', {}).get(label)
        if not e and (legacy or st.get('read', {}).get(label) == os.stat(f).st_mtime_ns):    # read, but no per-page result kept
            e = {'accepted': True, 'mtime': os.stat(f).st_mtime_ns, 'import': scan}
        if not e or e.get('mtime') != os.stat(f).st_mtime_ns:        # not read yet (or replaced since)
            out[label] = {'state': 'reading' if reading and label in st.get('reading', []) else 'received'}; continue
        r = reviews.get(e.get('import'), 'pending')
        p = {k: e[k] for k in ('page', 'score', 'values', 'flagged') if k in e}
        if not e.get('accepted'): p['state'] = 'retake'
        elif r == 'approved': p['state'] = 'approved'
        elif r in ('rejected', 'deleted'): p['state'] = 'rejected'
        else: p['state'] = 'read'
        if e.get('why'): p['why'] = str(e['why'])[:200]
        out[label] = p
    states = {p['state'] for p in out.values()}
    state = ('failed' if os.path.exists(os.path.join(folder, 'import-error.txt')) else 'reading' if reading
             else 'received' if states & {'received', 'reading'} else 'approved' if states <= {'approved'} else 'read')
    return 200, {'scan': scan, 'pages': list(out), 'state': state, 'page': out}


def route(inbox, method, path, body, user, subject=''):
    parts = path.split('?')[0].strip('/').split('/')
    if parts[:1] != ['scan-api']: return 404, {'error': 'Not found.'}
    parts = parts[1:]
    if method == 'GET' and len(parts) == 2 and parts[0] == 'status' and SCAN_ID.match(parts[1]): return status(inbox, parts[1])
    if method == 'POST' and len(parts) == 3 and parts[0] == 'upload' and SCAN_ID.match(parts[1]) and PAGE.match(parts[2]):
        return upload(inbox, parts[1], parts[2], body(), user, subject)
    return 404, {'error': 'Not found.'}


def make_handler(inbox):
    class H(BaseHTTPRequestHandler):
        def _go(self, method):
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_PHOTO: code, out = 413, {'error': 'Photo too big.'}
            else: code, out = route(inbox, method, self.path, lambda: self.rfile.read(n), self.headers.get('X-Scan-User', ''), self.headers.get('X-Scan-Subject', '').strip())
            data = json.dumps(out).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self): self._go('GET')
        def do_POST(self): self._go('POST')
        def log_message(self, *a): pass            # no addresses or ids in logs
    return H


if __name__ == '__main__':
    inbox = os.environ.get('SCAN_INBOX', 'inbox'); os.makedirs(inbox, exist_ok=True)
    port = int(os.environ.get('SCAN_PORT', '8788'))
    print(f'scan inbox on 127.0.0.1:{port}, folder {os.path.abspath(inbox)}', file=sys.stderr)
    ThreadingHTTPServer(('127.0.0.1', port), make_handler(inbox)).serve_forever()
