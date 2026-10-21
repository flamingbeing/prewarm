"""python3 watch_test.py  (fake photos only): which folders are read, what is sent, and that nothing is overwritten."""
import json, os, tempfile, time
import watch

d = tempfile.mkdtemp(); S = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
f = os.path.join(d, S); os.makedirs(f)
assert not watch.ready(f, time.time(), 90), 'no photos yet'
open(os.path.join(f, 'page-7.jpg'), 'wb').write(b'x'); open(os.path.join(f, 'page-x.png'), 'wb').write(b'y'); open(os.path.join(f, 'page-2.jpg'), 'wb').write(b'z'); open(os.path.join(f, 'page-12.jpg'), 'wb').write(b'w')
assert [l for l, _ in watch.photos(f)] == ['2', '7', '12', 'x'], 'sorted by number, x last'
os.remove(os.path.join(f, 'page-12.jpg'))
assert [l for l, _ in watch.photos(f)] == ['2', '7', 'x']
now = time.time()
assert not watch.ready(f, now, 90), 'a page just arrived: wait for the rest'
assert watch.ready(f, now + 100, 90)

sj = {'pages': [{'photo': 'page-2.jpg', 'page': 2, 'accepted': True, 'score': 0.9}, {'photo': 'page-7.jpg', 'page': 7, 'accepted': False, 'score': 0.4}],
      'fields': {'age': {'value': '67', 'flags': [], 'crop': 'AAAA', 'label': 'Age'}, 'wt': {'value': None, 'flags': []},
                 'pw_gown': {'value': '07:05', 'flags': ['hard to read']}, 'sex': {'value': None, 'flags': ['two ticks']}}}
doc = watch.build_doc(S, sj, 5)
assert doc['status'] == 'pending' and doc['scan'] == S and doc['createdAt'] == 5
assert doc['fields'] == {'age': {'v': '67', 'flags': []}, 'pw_gown': {'v': '07:05', 'flags': ['hard to read']}, 'sex': {'v': '', 'flags': ['two ticks']}}
assert 'crop' not in json.dumps(doc) and 'AAAA' not in json.dumps(doc) and 'Age' not in json.dumps(doc), 'no crops or labels'
assert doc['pages'][1] == {'page': 7, 'accepted': False, 'score': 0.4}
fv = watch.fs_value(doc)['mapValue']['fields']
assert fv['status'] == {'stringValue': 'pending'} and fv['createdAt'] == {'integerValue': '5'}
assert fv['fields']['mapValue']['fields']['age']['mapValue']['fields']['flags'] == {'arrayValue': {'values': []}}

# the Subject ID from the phone, and each value's page and place on it (coordinates only; a bad box is left out)
sjb = {'pages': [], 'fields': {'age': {'value': '67', 'flags': [], 'page': 2, 'box': {'x': 0.1, 'y': 0.2, 'w': 0.3, 'h': 0.04}},
                               'wt': {'value': '70', 'flags': [], 'page': 99, 'box': {'x': 2, 'y': 0, 'w': 1, 'h': 1}}}}
db = watch.build_doc(S, sjb, 5, 'DEMO-01')
assert db['subject'] == 'DEMO-01' and db['fields']['age'] == {'v': '67', 'flags': [], 'page': 2, 'box': {'x': 0.1, 'y': 0.2, 'w': 0.3, 'h': 0.04}}
assert db['fields']['wt'] == {'v': '70', 'flags': []}, 'page out of range and a box off the page are left out'
assert 'subject' not in watch.build_doc(S, sjb, 5, '<b>') and 'subject' not in watch.build_doc(S, sjb, 5)
open(os.path.join(f, 'meta.json'), 'w').write(json.dumps({'subject': 'DEMO-01', 'by': 'x'}))
assert watch.subject_of(f) == 'DEMO-01' and watch.subject_of(d) == ''

sent = []
out = watch.process(f, S, 'forms', 'proj', read=lambda *a: sj, send=lambda p, s, doc, t: sent.append((p, s, t, doc['status'], doc.get('subject'))) or 'created', get_token=lambda: 'tok')
assert out == 'created' and sent == [('proj', S, 'tok', 'pending', 'DEMO-01')], sent
assert json.load(open(os.path.join(f, 'imported.json')))['values'] == 3
assert not watch.ready(f, now + 1000, 90), 'imported folders are not read again'
# a failed read leaves no imported.json, so the folder is tried again
g = os.path.join(d, 'b1b2c3d4-e5f6'); os.makedirs(g); open(os.path.join(g, 'page-1.jpg'), 'wb').write(b'x')
def boom(*a): raise RuntimeError('ollama down')
try: watch.process(g, 'b1b2c3d4-e5f6', 'forms', 'proj', read=boom); assert False
except RuntimeError: pass
assert watch.ready(g, now + 1000, 90) and not os.path.exists(os.path.join(g, 'imported.json'))

# rounds: a photo sent after the read (a retake) is read on its own and filed as <scan>-2; the first import is left alone
time.sleep(0.01); open(os.path.join(f, 'page-7.jpg'), 'wb').write(b'retake')
assert [l for l, _ in watch.unread(f)] == ['7'] and watch.ready(f, time.time() + 100, 90)
got = []
sj2 = {'pages': [{'photo': 'page-7.jpg', 'page': 7, 'accepted': True, 'score': 0.88}], 'fields': {'t': {'value': '36.5', 'flags': [], 'page': 7}}}
watch.process(f, S, 'forms', 'proj', read=lambda folder, form, model, todo: got.append([l for l, _ in todo]) or sj2,
              send=lambda p, s, doc, t: sent.append(s) or 'created', get_token=lambda: 'tok')
assert got == [['7']] and sent[-1] == S + '-2', (got, sent)
st = json.load(open(os.path.join(f, 'status.json')))
assert st['state'] == 'read' and [i['id'] for i in st['imports']] == [S, S + '-2']
assert st['pages']['7']['accepted'] and st['pages']['7']['import'] == S + '-2' and st['pages']['2']['import'] == S
assert not watch.ready(f, time.time() + 1000, 90)
# review state: pending imports are looked up; a deleted one counts as rejected by inbox.py
looked = []
watch.reviews(f, 'proj', get=lambda p, i, t: looked.append(i) or ('approved' if i == S else 'pending'), get_token=lambda: 'tok')
watch.reviews(f, 'proj', get=lambda p, i, t: looked.append(i) or 'deleted', get_token=lambda: 'tok')
assert looked == [S, S + '-2', S + '-2'], looked
assert [i['review'] for i in json.load(open(os.path.join(f, 'status.json')))['imports']] == ['approved', 'deleted']
# a failed read leaves the folder waiting, not "reading"
time.sleep(0.01); open(os.path.join(f, 'page-2.jpg'), 'wb').write(b'again')
try: watch.process(f, S, 'forms', 'proj', read=boom); assert False
except RuntimeError: pass
assert json.load(open(os.path.join(f, 'status.json')))['state'] == 'received' and watch.unread(f)
# a folder imported before rounds existed counts as read
h = os.path.join(d, 'c1b2c3d4-e5f6'); os.makedirs(h); open(os.path.join(h, 'page-1.jpg'), 'wb').write(b'x'); open(os.path.join(h, 'imported.json'), 'w').write('{}')
assert not watch.ready(h, time.time() + 1000, 90) and watch.load_status(h)['imports'][0]['id'] == 'c1b2c3d4-e5f6'
# two photos found to be the same page: the weaker one is asked about
ps = watch.page_status({'pages': [{'photo': 'a.jpg', 'page': 4, 'accepted': True, 'score': 0.95}, {'photo': 'b.jpg', 'page': 4, 'accepted': True, 'score': 0.85}], 'fields': {}},
                       [('4', '/x/a.jpg'), ('5', '/x/b.jpg')], 'imp', {'4': 1, '5': 2})
assert 'why' not in ps['4'] and 'page 4 again' in ps['5']['why'] and ps['5']['page'] == 4
print('watch tests passed')
