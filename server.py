"""Local dev server: serves the static site and proxies grammar-correction
requests to Groq (falling back to Gemini) so the API keys stay server-side
and never reach the browser. Reads keys from .env in this directory — never
commit that file.

Run: python server.py [port]
"""
import json
import os
import re
import sys
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(HERE, 'docs')
os.makedirs(DOCS_DIR, exist_ok=True)
DOC_ID_RE = re.compile(r'^[A-Za-z0-9_-]+$')

SYSTEM_PROMPT = (
    "You are a background grammar, spelling, and punctuation correction engine "
    "embedded in a word processor. You will receive either a complete "
    "sentence or a clause fragment ending in a comma (sent early, before "
    "the user has finished the whole sentence, so a mid-sentence typo "
    "doesn't have to wait). Return ONLY the corrected text: fix spelling, "
    "grammar (subject-verb agreement, tense, pronoun case, double "
    "negatives, dangling modifiers), commonly confused words (their/"
    "there/they're, your/you're, its/it's, affect/effect, then/than), run-"
    "on sentences and comma splices, sentence fragments, and punctuation — "
    "commas, sentence-ending punctuation, quotation marks, apostrophes, "
    "capitalization. If the input ends in a comma, it is NOT the end of "
    "the sentence — keep it ending in a comma (do not add a period or "
    "capitalize a following word that isn't there) unless the comma "
    "itself is the actual error. The input may also be a fragment cut from "
    "the MIDDLE of a longer sentence you can't see the start of (sent this "
    "way so a mid-sentence typo doesn't have to wait for the whole "
    "sentence to finish) — if it starts with a lowercase conjunction or "
    "subordinator (and, but, or, so, because, though, although, since, "
    "while, yet), that lowercase start is very likely correct as a "
    "sentence continuation, not an error to capitalize. Preserve the "
    "user's own words, meaning, "
    "and tone as closely as possible — do not rephrase, reword, or add "
    "stylistic flourishes beyond what's needed to fix an actual error. "
    "NEVER insert an em dash (—). If the text is already correct, return "
    "it unchanged, with no commentary, quotes, or explanation."
)


def load_env():
    env = {}
    path = os.path.join(HERE, '.env')
    if not os.path.exists(path):
        return env
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            env[key.strip()] = value.strip()
    return env


ENV = load_env()

# Free-tier APIs soft-throttle a single key under rapid repeated use (no hard
# 429, just steadily increasing latency — confirmed by timing repeated calls
# directly against Gemini, no proxy involved: 0.8s, then 4.1s, then 3.3s on
# the same key back to back). With multiple keys configured, round-robin
# which one gets tried first each call so back-to-back sentences (a normal
# typing pattern) spread load instead of hammering one key into throttling.
_rr_lock = threading.Lock()
_rr_counters = {}


def ordered_keys(prefix):
    keys = []
    if ENV.get(prefix):
        keys.append(ENV[prefix])
    i = 2
    while ENV.get(f'{prefix}_{i}'):
        keys.append(ENV[f'{prefix}_{i}'])
        i += 1
    if len(keys) <= 1:
        return keys
    with _rr_lock:
        start = _rr_counters.get(prefix, 0)
        _rr_counters[prefix] = (start + 1) % len(keys)
    return keys[start:] + keys[:start]


# 5s per key/provider: gemini-3.5-flash-lite normally answers in well under
# 2s, so this is still generous headroom for one call. Kept short
# deliberately because correct_sentence() can fall through several keys
# sequentially (we have 3 Gemini + 2 Groq configured) — comma-boundary
# checks mean several requests can land in the same instant (fast typing,
# or a paste), so a real request has genuinely needed 2-3 key attempts
# before succeeding. The client's own abort timeout (app.js) is sized to
# tolerate the worst case of every key here timing out in sequence.
def call_groq(key, text):
    req = urllib.request.Request(
        'https://api.groq.com/openai/v1/chat/completions',
        data=json.dumps({
            'model': 'llama-3.3-70b-versatile',
            'temperature': 0,
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': text},
            ],
        }).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
        },
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data['choices'][0]['message']['content'].strip()


def call_gemini(key, text):
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key={key}',
        data=json.dumps({
            'systemInstruction': {'parts': [{'text': SYSTEM_PROMPT}]},
            'contents': [{'parts': [{'text': text}]}],
            'generationConfig': {'temperature': 0},
        }).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data['candidates'][0]['content']['parts'][0]['text'].strip()


def correct_sentence(text):
    errors = []
    # Gemini first: Groq's API rejected every key here with "Access denied,
    # check your network settings" — likely this network's egress, not the
    # keys themselves — so it's kept only as a fallback in case that clears.
    for key in ordered_keys('GEMINI_API_KEY'):
        try:
            return call_gemini(key, text), None
        except Exception as e:  # noqa: BLE001 - want to try every key/provider
            errors.append(f'gemini: {e}')
    for key in ordered_keys('GROQ_API_KEY'):
        try:
            return call_groq(key, text), None
        except Exception as e:  # noqa: BLE001
            errors.append(f'groq: {e}')
    return None, '; '.join(errors) or 'no API keys configured in .env'


def doc_path(doc_id):
    if not DOC_ID_RE.fullmatch(doc_id or ''):
        return None
    return os.path.join(DOCS_DIR, doc_id + '.json')


def list_docs():
    docs = []
    for fname in os.listdir(DOCS_DIR):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(DOCS_DIR, fname), encoding='utf-8') as f:
                d = json.load(f)
            docs.append({
                'id': d['id'],
                'title': d.get('title') or 'Untitled document',
                'updatedAt': d.get('updatedAt', ''),
            })
        except (OSError, json.JSONDecodeError, KeyError):
            continue
    docs.sort(key=lambda d: d['updatedAt'], reverse=True)
    return docs


def read_doc(doc_id):
    path = doc_path(doc_id)
    if not path or not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_doc(doc_id, title, html, created_at=None):
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    data = {
        'id': doc_id,
        'title': title or 'Untitled document',
        'html': html or '',
        'createdAt': created_at or now,
        'updatedAt': now,
    }
    with open(doc_path(doc_id), 'w', encoding='utf-8') as f:
        json.dump(data, f)
    return data


class Handler(BaseHTTPRequestHandler):
    def _static(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            path = '/index.html'
        full = os.path.normpath(os.path.join(HERE, path.lstrip('/')))
        if not full.startswith(HERE) or not os.path.isfile(full):
            self.send_response(404)
            self.end_headers()
            return
        types = {
            '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
            '.svg': 'image/svg+xml',
        }
        ctype = types.get(os.path.splitext(full)[1], 'application/octet-stream')
        with open(full, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/docs':
            self._json(200, list_docs())
            return
        if path.startswith('/api/docs/'):
            doc = read_doc(path[len('/api/docs/'):])
            if doc is None:
                self._json(404, {'error': 'not found'})
            else:
                self._json(200, doc)
            return
        self._static()

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            return json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            return {}

    def do_POST(self):
        if self.path == '/api/correct':
            payload = self._read_json_body()
            text = (payload.get('text') or '').strip()
            if not text:
                self._json(400, {'error': 'missing text'})
                return
            corrected, error = correct_sentence(text)
            if corrected is None:
                self._json(502, {'error': error})
            else:
                self._json(200, {'corrected': corrected})
            return
        if self.path == '/api/docs':
            payload = self._read_json_body()
            doc_id = f'doc_{int(time.time() * 1000)}'
            data = write_doc(doc_id, payload.get('title'), payload.get('html'))
            self._json(200, {'id': data['id'], 'updatedAt': data['updatedAt']})
            return
        self.send_response(404)
        self.end_headers()

    def do_PUT(self):
        path = self.path.split('?', 1)[0]
        if not path.startswith('/api/docs/'):
            self.send_response(404)
            self.end_headers()
            return
        doc_id = path[len('/api/docs/'):]
        if not DOC_ID_RE.fullmatch(doc_id):
            self._json(400, {'error': 'invalid id'})
            return
        existing = read_doc(doc_id)
        payload = self._read_json_body()
        data = write_doc(
            doc_id, payload.get('title'), payload.get('html'),
            created_at=existing['createdAt'] if existing else None,
        )
        self._json(200, {'id': data['id'], 'updatedAt': data['updatedAt']})

    def _json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep stdout quiet; errors still surface via the API response


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8756
    groq_n = len(ordered_keys('GROQ_API_KEY'))
    gemini_n = len(ordered_keys('GEMINI_API_KEY'))
    print(f'lag-writer serving on http://localhost:{port}  (groq keys: {groq_n}, gemini keys: {gemini_n})')
    ThreadingHTTPServer(('localhost', port), Handler).serve_forever()
