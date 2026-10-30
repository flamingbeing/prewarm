"""Put the form map and its page pictures where phones with "Read on phone" fetch them: Firestore forms/scan.

    python upload-form-map.py <folder with form-map.json and template-N.png> [version]

The folder is make-form-map.py's output. It holds the whole paper form as pictures, so it is kept privately and in
Firestore (members and admins can read forms/scan; see prewarm/firestore.rules), never in this repository.
Needs: gcloud signed in as the owner (its token bypasses the rules, as watch.py's does). SCAN_PROJECT picks the project
(default prewarm-study). Replaces the previous map; phones pick it up the next time they read a subject.
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request
from watch import fs_value, token

MAX_DOC = 1_000_000  # Firestore's limit is 1 MiB per document


def build(folder, version):
    fm = json.load(open(os.path.join(folder, 'form-map.json'), encoding='utf-8'))
    pages = sorted(fm['pages'], key=lambda p: p['page'])
    templates = []
    for n in range(1, max(p['page'] for p in pages) + 1):
        p = next((q for q in pages if q['page'] == n), None)
        templates.append(base64.b64encode(open(os.path.join(folder, p['template']), 'rb').read()).decode() if p else '')
    return {'version': str(version or fm.get('version') or time.strftime('%Y%m%d-%H%M')), 'map': json.dumps(fm, separators=(',', ':')),
            'templates': templates, 'setAt': int(time.time() * 1000), 'setBy': account()}


def account():
    r = subprocess.run(['gcloud', 'config', 'get-value', 'account'], capture_output=True, text=True, shell=(os.name == 'nt'))
    return r.stdout.strip() or 'gcloud'


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    doc = build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
    size = len(doc['map']) + sum(len(t) for t in doc['templates'])
    if size > MAX_DOC: sys.exit(f'Too big for one Firestore document: {size} bytes')
    project = os.environ.get('SCAN_PROJECT', 'prewarm-study')
    url = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/forms/scan'
    body = json.dumps({'fields': {k: fs_value(v) for k, v in doc.items()}}).encode()
    req = urllib.request.Request(url, data=body, method='PATCH', headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try: urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e: sys.exit(f'Firestore said {e.code}')
    print(f'forms/scan set: version {doc["version"]}, {len(doc["templates"])} pages, {size} bytes')


if __name__ == '__main__':
    main()
