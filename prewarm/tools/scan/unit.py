"""python3 unit.py  (no LibreOffice or photos needed): the small rules, on made-up values."""
import cv2, numpy as np
import plausible as p, scan, ticks

F = lambda id, type, **k: dict(id=id, type=type, **k)
# a field's place on its page, as fractions (cell and option boxes together; the crop on the admin's phone)
assert scan.field_box({'rect': [100, 200, 300, 260], 'options': {}}, 1000, 2000) == {'x': 0.1, 'y': 0.1, 'w': 0.2, 'h': 0.03}
assert scan.field_box({'options': {'0': [100, 50, 120, 70], '1': [400, 50, 420, 80]}}, 1000, 1000) == {'x': 0.1, 'y': 0.05, 'w': 0.32, 'h': 0.03}
assert scan.field_box({'options': {}}, 1000, 1000) is None
YN = [[0, 'No'], [1, 'Yes']]; TH = [[-3, '−3 Cold'], [0, '0 Neutral'], [3, '+3 Hot']]
# numbers: whole, decimal, 3-digit temperature, wide skin range, minus signs
assert p.clean(F('age', 'int'), '68') == (68, [])
assert p.clean(F('prewarm_0_core', 'num'), '365') == (36.5, [])
assert p.clean(F('iotemp_base_chest', 'num'), '25.9') == (25.9, [])                 # cold theatre skin is fine
assert p.clean(F('prewarm_0_core', 'num'), '45')[1] == ['outside 30-42']
assert p.clean(F('io_ebl', 'int'), '500') == (500, [])
assert p.clean(F('age', 'int'), '6.5')[1] == ['should be a whole number']
assert p.clean(F('prewarm_0_ts', 'code', opts=TH), '−3') == (-3, [])
assert p.clean(F('prewarm_0_ts', 'code', opts=TH), '+3') == (3, [])
assert p.clean(F('prewarm_0_ts', 'code', opts=TH), '5')[1][0].startswith('not one of')
# written Y / N
assert p.clean(F('iotemp_5_gown', 'code', opts=YN), 'Y') == (1, [])
assert p.clean(F('iotemp_5_gown', 'code', opts=YN), 'n') == (0, [])
assert p.clean(F('iotemp_5_gown', 'code', opts=YN), 'X')[1]
# times
assert p.clean(F('pw_gown', 'time'), '0820') == ('08:20', [])
assert p.clean(F('pw_gown', 'time'), '8:20') == ('08:20', [])
assert p.clean(F('pw_gown', 'time'), '25:00')[1] == ['not a 24-hour time']
# arrows and blanks
assert p.clean(F('iotemp_5_room', 'num'), 'ARROW') == (None, ['arrow or ditto: same as the reading above?'])
assert p.clean(F('iotemp_5_room', 'num'), '') == (None, [])
# ticks: a slash through the box that runs past its corners, an empty box, a stray speck
ink = np.zeros((200, 200), np.uint8)
cv2.line(ink, (28, 70), (62, 36), 1, 3)          # slash through the box (40,40)-(60,60), tail outside
ink[150, 150] = 1                                  # speck near an empty box
r = ticks.read_ticks(ink, [dict(rect=(40, 40, 60, 60)), dict(rect=(140, 140, 160, 160))])
assert [x['state'] for x in r] == ['ticked', 'empty'], r
# stacked boxes (30 px apart): a slash through the lower box whose tail runs up into the upper one
ink2 = np.zeros((200, 200), np.uint8)
cv2.line(ink2, (25, 112), (70, 52), 1, 3)          # from below-left of the lower box (40,80)-(60,100) up to the upper (40,40)-(60,60)
r2 = ticks.read_ticks(ink2, [dict(rect=(40, 40, 60, 60)), dict(rect=(40, 80, 60, 100))])
assert r2[1]['center'] >= 0.6 and r2[0]['center'] <= 0.15, r2    # the middle tells them apart even when both have ink
# handwriting present or not: digits yes, a thin leftover line or table edge no
digits = np.zeros((80, 160), np.uint8); cv2.putText(digits, '36.5', (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.6, 1, 3)
line = np.zeros((80, 160), np.uint8); line[40:42, 5:155] = 1
edge = np.zeros((80, 160), np.uint8); edge[:, 3:5] = 1
assert scan.has_writing(digits) and not scan.has_writing(line) and not scan.has_writing(edge)
# arrows: the shaft of a "same as above" arrow runs through the middle of the cell; a printed line sliver sits at its edge
cell = np.zeros((42, 106), np.uint8); cell[:, 52:55] = 1
assert scan.arrow_shaft(cell)
edge2 = np.zeros((42, 106), np.uint8); edge2[:, 1:4] = 1
assert not scan.arrow_shaft(edge2)
short = np.zeros((42, 106), np.uint8); short[10:22, 52:55] = 1
assert not scan.arrow_shaft(short)
# an arrow through a cell that also holds its head (so it counts as writing) is still an arrow; digits are not
thru = np.zeros((42, 106), np.uint8); thru[1:41, 52:55] = 1; thru[18:24, 40:48] = 1   # shaft, and a stray tick beside it
assert scan.through_arrow(thru) and not scan.through_arrow(digits) and not scan.through_arrow(short)
wide = np.zeros((42, 106), np.uint8); wide[2:40, 45:59] = 1                          # a tall letter stroke 0.13 wide
assert not scan.through_arrow(wide)
one = np.zeros((42, 106), np.uint8); cv2.putText(one, '1', (45, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 1, 3)
assert not scan.through_arrow(one)
# a crossed-out answer next to a new one is two marks; one letter is one
yn = np.zeros((42, 106), np.uint8); cv2.putText(yn, 'N', (40, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 1, 3)
assert scan.mark_groups(yn) == 1
yx = yn.copy(); cv2.putText(yx, 'Y', (8, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 1, 3); cv2.line(yx, (4, 30), (30, 8), 1, 2)
assert scan.mark_groups(yx) == 2
band = yn.copy(); band[:, 0:9] = 1                                                    # a printed edge leaking in
assert scan.mark_groups(band) == 1
# empty cells between arrows are flagged, a genuinely empty column is not
F = {f'iotemp_{p}_room': dict(id=f'iotemp_{p}_room', series='iotemp', col='room', point=p) for p in ('0', '5', '10', '15', '20', '25')}
E = lambda **k: {'value': None, 'flags': [], **k}
out = {'iotemp_0_room': E(), 'iotemp_5_room': E(flags=['arrow or ditto: same as the reading above?']), 'iotemp_10_room': E(),
       'iotemp_15_room': E(flags=['arrow or ditto: same as the reading above?']), 'iotemp_20_room': E(), 'iotemp_25_room': dict(value=18, flags=[])}
scan.arrow_gaps(out, F)
assert out['iotemp_10_room']['flags'] and out['iotemp_20_room']['flags'] and not out['iotemp_0_room']['flags']
# arrows repeat the reading above (an empty cell the arrow runs through too); an arrow with nothing above stays flagged
AR = 'arrow or ditto: same as the reading above?'
out = {'iotemp_0_room': dict(value=18, flags=[]), 'iotemp_5_room': E(flags=[AR]), 'iotemp_10_room': E(),
       'iotemp_15_room': E(flags=[AR]), 'iotemp_20_room': dict(value=19, flags=[]), 'iotemp_25_room': E()}
scan.arrow_gaps(out, F); scan.fill_arrows(out, F)
assert [out[f'iotemp_{p}_room']['value'] for p in ('0', '5', '10', '15', '20', '25')] == [18, 18, 18, 18, 19, None], out
assert not out['iotemp_5_room']['flags'] and out['iotemp_5_room']['notes'] == ['arrow: copied from the reading above']
assert not out['iotemp_25_room']['flags']                       # a genuinely empty cell after a reading stays empty
# a reading that needs checking is copied down, but every copy is flagged too
chk = {'iotemp_0_room': dict(value=81, flags=['outside 10-40']), 'iotemp_5_room': E(flags=[AR]), 'iotemp_10_room': E(flags=[AR]),
       'iotemp_15_room': dict(value=19, flags=[]), 'iotemp_20_room': E(flags=[AR]), 'iotemp_25_room': E()}
scan.fill_arrows(chk, F)
assert chk['iotemp_5_room']['flags'] and chk['iotemp_10_room']['flags'] and not chk['iotemp_20_room']['flags'], chk
top = {'iotemp_0_room': E(flags=[AR]), 'iotemp_5_room': dict(value=18, flags=[])}
scan.fill_arrows(top, F)
assert top['iotemp_0_room']['value'] is None and top['iotemp_0_room']['flags'] == [AR]
# series order: baseline first, minutes in order, end of surgery last (a baseline next to the end of surgery is not a "jump")
arm = {'base': 35.0, '0': 35.2, '5': 34.9, '10': 34.2, '300': 29.8, 'end': 23.6}
fo = {f'iotemp_{k}_arm': {'value': v, 'flags': []} for k, v in arm.items()}
ff = {f'iotemp_{k}_arm': dict(id=f'iotemp_{k}_arm', series='iotemp', col='arm', point=k) for k in arm}
scan.series_checks(fo, ff)
assert not fo['iotemp_base_arm']['flags'] and not fo['iotemp_0_arm']['flags'], fo
assert fo['iotemp_end_arm']['flags'], 'the real 23.6 after 29.8 is still flagged'
assert sorted(['300', 'end', 'base', '5', '0'], key=lambda k: scan.point_order(('x', k))) == ['base', '0', '5', '300', 'end']
# a ticked question where one option also ticks a box further down (No pre-warming also ticks 'Not applicable')
import locate
# the real Randomisation row: options 1 and 2 on one line; option 3 ticks its own box AND 'Not applicable' lower down, which
# is nearer the other two's centre, so nearest-by-distance is wrong: the box on the same row is right
pick = locate.choose_glyphs({'1': [[215, 492, 246, 522]], '2': [[640, 492, 670, 522]], '3': [[1050, 492, 1080, 522], [601, 829, 631, 860]]})
assert pick['3'] == [1050, 492, 1080, 522], pick
# stacked options (one column): the candidate in the same column wins
pick = locate.choose_glyphs({'a': [[100, 100, 130, 130]], 'b': [[100, 160, 130, 190]], 'c': [[100, 220, 130, 250], [700, 230, 730, 260]]})
assert pick['c'] == [100, 220, 130, 250], pick
# no other options to line up with: the top-most, left-most box
assert locate.choose_glyphs({'x': [[500, 800, 530, 830], [100, 300, 130, 330]]})['x'] == [100, 300, 130, 330]
# the Ollama reader: a fake server on this machine answers like Ollama; nothing else is called
import json, os, tempfile, threading, http.server
import readers, bench
G = lambda id, type, **k: dict(id=id, type=type, **k)
seen = []
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.append(body)
        reply = {'message': {'content': '{"text": "36.4", "legible": true}' if len(seen) == 1 else 'not json'}}
        self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(reply).encode())
srv = http.server.HTTPServer(('127.0.0.1', 0), Fake); threading.Thread(target=srv.serve_forever, daemon=True).start()
r = readers.OllamaReader('test-model', f'127.0.0.1:{srv.server_port}')
fcore = G('prewarm_0_core', 'num', label='Core temp', unit='°C')
assert r.read(b'png', fcore, 0) == {'text': '36.4', 'legible': True}
assert seen[0]['think'] is False and seen[0]['options']['num_predict'] == 64
assert seen[0]['model'] == 'test-model' and seen[0]['messages'][0]['images'] and 'Core temp' in seen[0]['messages'][0]['content']
assert r.read(b'png', fcore, 1) == {'text': '', 'legible': False}      # a reply that isn't JSON is "can't read", never a guess
srv.shutdown()
# bench: right, flagged and silently wrong are told apart
d = tempfile.mkdtemp()
fs = [G('a_core', 'num', label='a'), G('b_core', 'num', label='b'), G('c_core', 'num', label='c')]
json.dump(fs, open(f'{d}/fields.json', 'w'))
for f in fs: cv2.imwrite(f'{d}/{f["id"]}.png', np.full((20, 40), 255, np.uint8))
json.dump({'fields': {'a_core': '36.5', 'b_core': '36.6', 'c_core': '36.7'}}, open(f'{d}/truth.json', 'w'))
stub = readers.StubReader({'a_core': '36.5', 'b_core': '36.6', 'c_core': '36.1'}, wrong={('b_core', 1): '36.8'})
res = bench.main(['--form-dir', d, '--crops', d, '--truth', f'{d}/truth.json'], reader=stub)
assert res == {'right': ['a_core'], 'flagged': ['b_core'], 'WRONG': ['c_core']}, res
# page pick: the phone's page number is kept unless another page lines up clearly better (a burst shot out of order)
_al, _gp = scan.aligned, scan.align.guess_page
fit = {0: 0.70, 1: 0.86, 2: 0.88, 3: 0.95}
scan.aligned = lambda img, tpl, tables: ('flat', fit[tpl], [])
scan.align.guess_page = lambda img, tpls: (None, [0.1, 0.5, 0.4, 0.3])        # quick guess ranks 1, 2, 3 first
tp = [0, 1, 2, 3]
assert scan.best_page(None, tp, lambda pg: [], hint=3)[:2] == (3, 'flat'), 'page 4 (0.95) beats the phone page 3 (0.88)'
assert scan.best_page(None, tp, lambda pg: [])[0] == 3, 'no hint: the best fit'
assert scan.best_page(None, tp, lambda pg: [], hint=4)[0] == 3
fit[3] = 0.90
assert scan.best_page(None, tp, lambda pg: [], hint=3)[0] == 2, 'within the margin the phone wins'
assert scan.best_page(None, tp, lambda pg: [], hint=1)[0] == 3, 'hint outside the quick guess is tried, then beaten'
fit[0] = 0.91
assert scan.best_page(None, tp, lambda pg: [], hint=1)[0] == 0, 'hint outside the quick guess is tried and kept'
assert scan.best_page(None, tp, lambda pg: [], forced=2)[0] == 1
scan.aligned, scan.align.guess_page = _al, _gp
print('unit: ok')
