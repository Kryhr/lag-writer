"""Local dev server: serves the static site and proxies grammar-correction
requests to Groq (falling back to Gemini) so the API keys stay server-side
and never reach the browser. Reads keys from .env in this directory — never
commit that file.

Run: python server.py [port]
"""
import json
import os
import sys
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

SYSTEM_PROMPT = (
    "You are a background grammar and spelling correction engine embedded in a "
    "word processor. You will receive a single sentence. Return ONLY the "
    "corrected sentence with spelling and grammar errors fixed, preserving the "
    "original meaning, tone, and style (contractions, capitalization) as "
    "closely as possible. Do not add commentary, quotes, or explanations. If "
    "the sentence is already correct, return it unchanged."
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


def ordered_keys(prefix):
    keys = []
    if ENV.get(prefix):
        keys.append(ENV[prefix])
    i = 2
    while ENV.get(f'{prefix}_{i}'):
        keys.append(ENV[f'{prefix}_{i}'])
        i += 1
    return keys


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
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data['choices'][0]['message']['content'].strip()


def call_gemini(key, text):
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={key}',
        data=json.dumps({
            'contents': [{'parts': [{'text': f'{SYSTEM_PROMPT}\n\nSentence: {text}'}]}],
        }).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
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
        types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}
        ctype = types.get(os.path.splitext(full)[1], 'application/octet-stream')
        with open(full, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._static()

    def do_POST(self):
        if self.path != '/api/correct':
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', 0))
        try:
            payload = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            payload = {}
        text = (payload.get('text') or '').strip()
        if not text:
            self._json(400, {'error': 'missing text'})
            return
        corrected, error = correct_sentence(text)
        if corrected is None:
            self._json(502, {'error': error})
        else:
            self._json(200, {'corrected': corrected})

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
