"""python3 inbox_test.py  (fake photos only): the upload inbox's rules, directly and over a real local connection."""
import json, os, tempfile, threading, time, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
import inbox

JPG = b'\xff\xd8\xff\xe0' + b'x' * 50
PNG = b'\x89PNG\r\n\x1a\n' + b'y' * 50
ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
d = tempfile.mkdtemp()
r = lambda m, p, b=b'', u='member@example.com', s='': inbox.route(d, m, p, lambda: b, u, s)

assert r('POST', f'/scan-api/upload/{ID}/4', JPG) == (200, {'ok': True, 'pages': ['4']})
assert r('POST', f'/scan-api/upload/{ID}/x', PNG)[1]['pages'] == ['4', 'x']
assert os.path.exists(os.path.join(d, ID, 'page-4.jpg')) and os.path.exists(os.path.join(d, ID, 'page-x.png'))
assert json.load(open(os.path.join(d, ID, 'meta.json')))['by'] == 'member@example.com'
# a resend replaces the page, whatever its format
assert r('POST', f'/scan-api/upload/{ID}/4', PNG)[1]['pages'] == ['4', 'x']
assert os.path.exists(os.path.join(d, ID, 'page-4.png')) and not os.path.exists(os.path.join(d, ID, 'page-4.jpg'))
assert r('GET', f'/scan-api/status/{ID}') == (200, {'scan': ID, 'pages': ['4', 'x'], 'state': 'received', 'page': {'4': {'state': 'received'}, 'x': {'state': 'received'}}})
assert r('GET', '/scan-api/status/ffffffff-0000')[0] == 404
# the Subject ID typed on the phone is kept with the scan; odd characters are refused
assert r('POST', f'/scan-api/upload/{ID}/4', PNG, s='DEMO-01')[0] == 200
assert json.load(open(os.path.join(d, ID, 'meta.json')))['subject'] == 'DEMO-01'
assert r('POST', f'/scan-api/upload/{ID}/4', PNG, s='<b>')[0] == 400
assert r('POST', f'/scan-api/upload/{ID}/4', PNG, s='A' * 41)[0] == 400
# refusals
assert r('POST', f'/scan-api/upload/{ID}/1', b'')[0] == 400
assert r('POST', f'/scan-api/upload/{ID}/1', b'GIF89a....')[0] == 415
assert r('POST', f'/scan-api/upload/{ID}/1', JPG + b'0' * inbox.MAX_PHOTO)[0] == 413
assert r('POST', f'/scan-api/upload/{ID}/0', JPG)[0] == 404
assert r('POST', f'/scan-api/upload/{ID}/15', JPG)[0] == 404
assert r('POST', f'/scan-api/upload/{ID}/010', JPG)[0] == 404
assert r('POST', '/scan-api/upload/short/1', JPG)[0] == 404
assert r('POST', '/scan-api/upload/..%2f..%2fx/1', JPG)[0] == 404
assert r('POST', f'/scan-api/upload/{ID}/../1', JPG)[0] == 404
assert r('DELETE', f'/scan-api/status/{ID}')[0] == 404
assert r('GET', '/other')[0] == 404
assert not os.path.exists(os.path.join(d, 'short'))
# no more than MAX_PAGES files per scan
ID2 = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890'
for p in [*map(str, range(1, 15)), 'x']: assert r('POST', f'/scan-api/upload/{ID2}/{p}', JPG)[0] == 200, p
assert len(inbox.pages_of(os.path.join(d, ID2))) == 15
# status after watch.py has read the folder: per page read / retake / moved, then the review state of its import
import watch
ID3 = 'c1b2c3d4-e5f6-7890-abcd-ef1234567890'; f3 = os.path.join(d, ID3)
for p in ('1', '2', '3'): r('POST', f'/scan-api/upload/{ID3}/{p}', JPG)
open(os.path.join(f3, 'import-error.txt'), 'w').write('x')
assert r('GET', f'/scan-api/status/{ID3}')[1]['state'] == 'failed'
r('POST', f'/scan-api/upload/{ID3}/3', JPG)
assert not os.path.exists(os.path.join(f3, 'import-error.txt')), 'a new photo clears the error stop'
sj = {'pages': [{'photo': 'page-1.jpg', 'page': 1, 'accepted': True, 'score': 0.93}, {'photo': 'page-2.jpg', 'page': 3, 'accepted': True, 'score': 0.9},
                {'photo': 'page-3.jpg', 'page': 3, 'accepted': False, 'score': 0.41}],
      'fields': {'a': {'value': '1', 'flags': [], 'page': 1}, 'b': {'value': '2', 'flags': ['hard to read'], 'page': 1}, 'c': {'value': '', 'flags': [], 'page': 3}}}
watch.process(f3, ID3, 'forms', 'proj', read=lambda *a: sj, send=lambda *a: 'created', get_token=lambda: 't')
code, st = r('GET', f'/scan-api/status/{ID3}')
assert code == 200 and st['state'] == 'read', st
assert st['page']['1'] == {'page': 1, 'score': 0.93, 'values': 2, 'flagged': 1, 'state': 'read'}, st['page']['1']
assert st['page']['2']['page'] == 3 and st['page']['2']['state'] == 'read', 'page 2 was really page 3: the phone moves it'
assert st['page']['3']['state'] == 'retake' and 'line up' in st['page']['3']['why']
assert 'value' not in json.dumps(st).replace('values', ''), 'no values in the status'
watch.reviews(f3, 'proj', get=lambda p, i, t: 'approved', get_token=lambda: 't')
st = r('GET', f'/scan-api/status/{ID3}')[1]
assert st['page']['1']['state'] == 'approved' and st['page']['3']['state'] == 'retake' and st['state'] == 'read'
time.sleep(0.01); r('POST', f'/scan-api/upload/{ID3}/3', PNG)
st = r('GET', f'/scan-api/status/{ID3}')[1]
assert st['page']['3'] == {'state': 'received'} and st['state'] == 'received', 'a retake waits to be read'
# a scan read before status.json existed counts as read
ID4 = 'd1b2c3d4-e5f6-7890-abcd-ef1234567890'; r('POST', f'/scan-api/upload/{ID4}/1', JPG); open(os.path.join(d, ID4, 'imported.json'), 'w').write('{}')
assert r('GET', f'/scan-api/status/{ID4}')[1] == {'scan': ID4, 'pages': ['1'], 'state': 'read', 'page': {'1': {'state': 'read'}}}
# over a real connection
srv = ThreadingHTTPServer(('127.0.0.1', 0), inbox.make_handler(d)); threading.Thread(target=srv.serve_forever, daemon=True).start()
u = f'http://127.0.0.1:{srv.server_address[1]}/scan-api'
req = urllib.request.Request(f'{u}/upload/{ID}/2', data=JPG, method='POST', headers={'X-Scan-User': 'a@b.c', 'X-Scan-Subject': 'DEMO-02'})
assert json.load(urllib.request.urlopen(req))['pages'] == ['2', '4', 'x']
assert json.load(urllib.request.urlopen(f'{u}/status/{ID}'))['state'] == 'received'
assert json.load(open(os.path.join(d, ID, 'meta.json')))['subject'] == 'DEMO-02'
try: urllib.request.urlopen(f'{u}/status/nope-nope-nope'); assert False
except urllib.error.HTTPError as e: assert e.code == 404
srv.shutdown()
print('inbox tests passed')
