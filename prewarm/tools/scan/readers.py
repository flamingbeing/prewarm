"""Who reads a handwritten crop. Each reader returns {'text': str, 'legible': bool}. The tool asks twice, with
different framing and scale, and only trusts a value when both reads agree."""
import base64, json, os, re

PROMPT_A = ('This is a cropped cell from a printed anaesthesia study data sheet, photographed with a phone. '
            'Field: "{label}"{unit}. Expected: {expect}. Printed text (labels, units, lines, tick boxes) may be visible: '
            'read ONLY the handwritten entry. Reply with JSON only: {{"text": "<what is written>", "legible": true|false}}. '
            'Read the entry in the middle of the image; digits cut off at the edges belong to a neighbouring cell. Use digits, and "." or ":" if written, and a leading minus sign if there is one. A cell with no handwriting is {{"text": "", "legible": true}}. If the cell holds only an arrow, a long vertical line or a ditto mark ("same as above"), reply {{"text": "ARROW", "legible": true}}. If a number is struck through and rewritten, read the rewritten one and set legible to false. '
            'If you are not certain of every digit set legible to false and still give your best reading. Do not guess from context.')
PROMPT_B = ('Transcribe the handwriting in this image digit by digit. It is one entry for "{label}"{unit} ({expect}); '
            'ignore anything printed. Return JSON only: {{"text": "...", "legible": true|false}}. Empty if nothing is written. '
            'legible=false if any character could be read two ways.')


def _expect(f):
    if f.get('opts'):
        return 'one of ' + ', '.join(str(o[1] if isinstance(o, (list, tuple)) else o) for o in f['opts']) + ' (often just the first letter, or the number)'
    return {'time': 'a 24-hour clock time such as 07:05', 'num': 'a decimal number', 'int': 'a whole number',
            'code': 'a number'}.get(f['type'], 'text')


class AnthropicReader:
    """Claude vision. Needs `pip install anthropic` and ANTHROPIC_API_KEY in the environment. Only crops of de-identified
    cells (numbers, times) are ever sent: never IDs, dates, names or free text."""
    def __init__(self, model=None, key_file=None):
        import anthropic
        # The key can come from a private file given to this one process (--key-file), so it need not live in an
        # environment variable (a user-level ANTHROPIC_API_KEY stopped Remote Control starting on the home computer).
        key = open(key_file, encoding='utf-8').read().strip() if key_file else None
        # Sonnet by default (cheaper); SCAN_MODEL=claude-opus-5-5 for the hardest pages
        self.client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
        self.model = model or os.environ.get('SCAN_MODEL', 'claude-sonnet-5-5')

    def read(self, png, f, variant):
        unit = f' ({f["unit"]})' if f.get('unit') else ''
        prompt = (PROMPT_A if variant == 0 else PROMPT_B).format(label=f['label'], unit=unit, expect=_expect(f))
        msg = self.client.messages.create(model=self.model, max_tokens=100, messages=[{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(png).decode()}},
            {'type': 'text', 'text': prompt}]}])
        raw = ''.join(b.text for b in msg.content if b.type == 'text')
        m = re.search(r'\{.*\}', raw, re.S)
        try:
            j = json.loads(m.group(0))
            return {'text': str(j.get('text', '')), 'legible': bool(j.get('legible', False))}
        except Exception:
            return {'text': '', 'legible': False}


class OllamaReader:
    """A vision model on this computer through Ollama (no API, nothing leaves the PC). Same two prompts and the same
    two-read agreement as the Claude reader. Needs Ollama running and a model that accepts images (`ollama show <model>`
    lists "vision"); --model or SCAN_MODEL picks it, OLLAMA_HOST the server."""
    def __init__(self, model=None, host=None):
        self.model = model or os.environ.get('SCAN_MODEL', 'gemma4:12b')
        self.url = (host or os.environ.get('OLLAMA_HOST', 'http://localhost:11434')).rstrip('/')
        if not self.url.startswith('http'):
            self.url = 'http://' + self.url

    def read(self, png, f, variant):
        import urllib.request
        unit = f' ({f["unit"]})' if f.get('unit') else ''
        prompt = (PROMPT_A if variant == 0 else PROMPT_B).format(label=f['label'], unit=unit, expect=_expect(f))
        # think off: gemma4 otherwise writes ~270 tokens of reasoning per crop (11 s instead of 1.4 s, same reads);
        # keep_alive saves a 7-10 s reload between pages; num_predict stops a runaway (answers are ~15 tokens)
        body = json.dumps({'model': self.model, 'stream': False, 'format': 'json', 'think': False, 'keep_alive': '30m',
                           'options': {'temperature': 0, 'num_predict': 64},
                           'messages': [{'role': 'user', 'content': prompt, 'images': [base64.b64encode(png).decode()]}]})
        req = urllib.request.Request(self.url + '/api/chat', body.encode(), {'Content-Type': 'application/json'})
        try:
            raw = json.load(urllib.request.urlopen(req, timeout=300))['message']['content']
            j = json.loads(re.search(r'\{.*\}', raw, re.S).group(0))
            return {'text': str(j.get('text', '')), 'legible': bool(j.get('legible', False))}
        except Exception:
            return {'text': '', 'legible': False}


class StubReader:
    """For tests: answers from a known truth, optionally wrong now and then, so the checks can be exercised."""
    def __init__(self, truth, wrong=None):
        self.truth, self.wrong = truth, wrong or {}

    def read(self, png, f, variant):
        t = self.wrong.get((f['id'], variant), self.truth.get(f['id'], ''))
        return {'text': t, 'legible': True}


class FileReader:
    """No API: readings someone else made from the exported crops, as {field id: text} or {field id: {"text", "legible"}}.
    With a second file (made independently, from the 2x sheets) the two reads are compared, so a disagreement is flagged;
    with one file the same text stands in for both reads and the review screen is the only check."""
    def __init__(self, path, path2=None):
        load = lambda p: json.load(open(p, encoding='utf-8'))
        self.a = load(path)
        self.b = load(path2) if path2 else self.a
        self.two = bool(path2)
        self.asked, self.missing = set(), set()

    def read(self, png, f, variant):
        src = self.a if variant == 0 or not self.two else self.b
        self.asked.add(f['id'])
        r = src.get(f['id'])
        if r is None:
            self.missing.add(f['id'])
            return {'text': '', 'legible': False}
        if isinstance(r, dict):           # {"text": "34.0", "legible": false}: say so when a cell is hard to read
            return {'text': str(r.get('text', '')), 'legible': bool(r.get('legible', True))}
        return {'text': str(r), 'legible': True}


class NoReader:
    """Nobody reads the handwriting: the owner types every written value in the review screen (ticks are still read)."""
    reads_nothing = True

    def read(self, png, f, variant):
        return {'text': '', 'legible': False}


class CropExporter:
    """Writes each handwritten crop to a folder, with a manifest and numbered contact sheets for whoever reads them: sheet a-NN
    (the crops as they are) for the first reading, sheet b-NN (bigger, a different layout) for an independent second one. Reads
    nothing itself."""
    reads_nothing = True

    def __init__(self, folder):
        self.folder, self.items = folder, []
        os.makedirs(folder, exist_ok=True)

    def read(self, png, f, variant):
        if variant == 0:
            self.items.append((f, png))
            open(os.path.join(self.folder, f['id'] + '.png'), 'wb').write(png)
        return {'text': '', 'legible': False}

    def finish(self):
        import cv2, numpy as np
        import plausible
        json.dump({f['id']: dict(label=f['label'], type=f['type'], unit=f.get('unit'), allowed=plausible.allowed(f)) for f, _ in self.items},
                  open(os.path.join(self.folder, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
        for prefix, tile_h, tile_w, cols, rows, scale in (('a', 80, 230, 4, 6, 1), ('b', 150, 420, 2, 5, 2)):
            tiles = []
            for f, png in self.items:
                im = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
                if scale != 1:
                    im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                    im = cv2.normalize(im, None, 0, 255, cv2.NORM_MINMAX)
                k = min(tile_h / im.shape[0], tile_w / im.shape[1]); im = cv2.resize(im, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
                t = np.full((tile_h + 30, tile_w + 10), 255, np.uint8)
                t[4:4 + im.shape[0], 5:5 + im.shape[1]] = im
                cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), 150, 1)
                cv2.putText(t, f['id'][:34], (4, tile_h + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.38, 0, 1, cv2.LINE_AA)
                cv2.putText(t, f['label'][:34], (4, tile_h + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.34, 90, 1, cv2.LINE_AA)
                tiles.append(t)
            per = cols * rows
            for n in range(0, len(tiles), per):
                chunk = tiles[n:n + per]
                th, tw = tiles[0].shape
                used = -(-len(chunk) // cols)            # only the rows that have tiles
                sheet = np.full((used * th, cols * tw), 255, np.uint8)
                for i, t in enumerate(chunk):
                    r, c = divmod(i, cols); sheet[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = t
                cv2.imwrite(os.path.join(self.folder, f'{prefix}-{n // per + 1:02d}.png'), sheet)
