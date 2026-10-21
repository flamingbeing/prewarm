"""What a value on this form can sensibly be. Used to flag readings for the review screen, never to fix them."""
import re

# (field id pattern, low, high); first match wins
RANGES = [
    (r'^(prewarm|iotemp)_\w+_core$|^pacu_temp$', 30, 42),
    (r'^(prewarm|iotemp)_\w+_(chest|arm|thigh|calf)$', 20, 42),   # skin runs cold in a cold theatre
    (r'^(prewarm)_\w+_set$', 30, 50),
    (r'^iotemp_\w+_room$', 15, 30),
    (r'_ts$', -3, 3),
    (r'_sbp$', 40, 260), (r'_dbp$', 20, 160), (r'_map$', 30, 200), (r'_hr$', 20, 220), (r'_bis$', 0, 100),
    (r'^age$', 16, 110), (r'^wt$', 30, 250), (r'^ht$', 120, 220), (r'^bmi$', 12, 70),
    (r'^pre_hb$', 3, 20), (r'^pre_wbc$', 0.5, 80), (r'^pre_plt$', 5, 1500), (r'^pre_inr$', 0.5, 10), (r'^pacu_pain$', 0, 10),
    (r'^io_(rbc|plt|ffp|cryo)$', 0, 50), (r'^io_(rbc|plt|ffp|cryo)_ml$', 0, 20000),
    (r'^io_ebl$', 0, 20000), (r'^io_cs_(vol|ret)$', 0, 10000), (r'^io_pcc_dose$', 0, 10000),
    (r'^io_txa_(bolus|inf|total)$', 0, 10000), (r'^io_fib_dose$', 0, 20),
]


def normalise_temp(s):
    t = str(s).strip().replace(',', '.')
    if re.fullmatch(r'\d{3}', t) and 25 <= int(t) / 10 <= 45:
        return str(int(t) / 10)
    return t


def clean(f, text):
    """(value, problems) for the text read from a field of this type; value None when it can't be used."""
    text = (text or '').strip().replace('\u2212', '-').replace('\u2013', '-')
    if text == '':
        return None, []
    kind = f['type']
    if re.match(r'(?i)arrow|ditto|same', text):   # an arrow or ditto: "same as above", which only a person can place
        return None, ['arrow or ditto: same as the reading above?']
    if kind == 'code' and f.get('opts'):
        f = dict(f, opts=[o if isinstance(o, (list, tuple)) else [o, o] for o in f['opts']])
        keys = {str(k): k for k, _ in f['opts']}
        t = text.replace('+', '')
        if t in keys:
            return keys[t], []
        letters = {}
        for k, label in f['opts']:
            c = str(label).strip()[:1].upper()
            letters[c] = None if c in letters else k   # a letter shared by two options can't pick one
        k = letters.get(text.upper())
        if k is not None:
            return k, []
        return text, ['not one of: ' + ', '.join(str(l) for _, l in f['opts'])]
    if kind == 'time':
        m = re.fullmatch(r'(\d{1,2})\s*[:.]?\s*(\d{2})', text)
        if not m or int(m[1]) > 23 or int(m[2]) > 59:
            return text, ['not a 24-hour time']
        return f'{int(m[1]):02d}:{m[2]}', []
    if kind in ('num', 'int', 'code'):
        if text.upper() == 'NA':
            return 'NA', []
        t = normalise_temp(text) if kind == 'num' else text
        try:
            n = float(t)
        except ValueError:
            return text, ['not a number']
        if (kind == 'int' or f['id'].endswith('_ts')) and n != int(n):
            return text, ['should be a whole number']
        probs = []
        for pat, lo, hi in RANGES:
            if re.search(pat, f['id']):
                if not lo <= n <= hi:
                    probs.append(f'outside {lo}-{hi}')
                break
        return (int(n) if kind == 'int' or f['id'].endswith('_ts') else n), probs
    return text, []


def allowed(f):
    """A short plain statement of what a reading of this field can be (for whoever reads the crops)."""
    if f.get('opts'):
        return 'one of: ' + ', '.join(str(o[1] if isinstance(o, (list, tuple)) else o) for o in f['opts']) + ' (usually just the letter or number)'
    if f['type'] == 'time':
        return 'a 24-hour clock time, like 07:05'
    if f['type'] in ('num', 'int', 'code'):
        for pat, lo, hi in RANGES:
            if re.search(pat, f['id']):
                return f'a number from {lo} to {hi}' + (' (whole)' if f['type'] == 'int' else '')
        return 'a number'
    return 'text'
