"""Runs every case in tests/cases.json against a running lag-writer server,
times each one, and appends the result to tests/results.jsonl so speed and
output can be tracked over time instead of relying on memory.

Requires the server to already be running (python server.py) — this only
exercises the /api/correct endpoint, not the browser/DOM side.

Usage: python tests/run_tests.py [port]
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_PATH = os.path.join(HERE, 'cases.json')
RESULTS_PATH = os.path.join(HERE, 'results.jsonl')

SLOW_THRESHOLD_S = 3.0  # the "onto the next word within 3 seconds" target


def load_cases():
    with open(CASES_PATH, encoding='utf-8') as f:
        return json.load(f)


def load_last_results():
    """Returns {case_id: most_recent_result} from prior runs, if any."""
    last = {}
    if not os.path.exists(RESULTS_PATH):
        return last
    with open(RESULTS_PATH, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            last[rec['id']] = rec
    return last


def call_correct(base_url, text):
    req = urllib.request.Request(
        f'{base_url}/api/correct',
        data=json.dumps({'text': text}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            elapsed = time.perf_counter() - start
            return data.get('corrected'), elapsed, None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        elapsed = time.perf_counter() - start
        return None, elapsed, str(e) or type(e).__name__


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else '8756'
    base_url = f'http://localhost:{port}'

    cases = load_cases()
    previous = load_last_results()

    print(f'Running {len(cases)} test case(s) against {base_url} ...\n')

    with open(RESULTS_PATH, 'a', encoding='utf-8') as out:
        for case in cases:
            corrected, elapsed, error = call_correct(base_url, case['text'])
            record = {
                'id': case['id'],
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'input': case['text'],
                'corrected': corrected,
                'elapsed_s': round(elapsed, 3),
                'error': error,
            }
            out.write(json.dumps(record) + '\n')

            prev = previous.get(case['id'])
            speed_note = ''
            if prev and prev.get('elapsed_s') is not None:
                delta = record['elapsed_s'] - prev['elapsed_s']
                arrow = 'faster' if delta < 0 else 'slower' if delta > 0 else 'same'
                speed_note = f'  ({arrow} by {abs(delta):.2f}s vs last run)'
            changed_note = ''
            if prev and prev.get('corrected') != record['corrected']:
                changed_note = '  [output changed since last run]'

            status = 'ERROR' if error else ('SLOW' if elapsed > SLOW_THRESHOLD_S else 'ok')
            print(f'[{status:>5}] {case["id"]}  {record["elapsed_s"]}s{speed_note}{changed_note}')
            if error:
                print(f'         error: {error}')
            else:
                print(f'         in:  {case["text"]}')
                print(f'         out: {corrected}')
            print()

    print(f'Results appended to {os.path.relpath(RESULTS_PATH)}')


if __name__ == '__main__':
    main()
