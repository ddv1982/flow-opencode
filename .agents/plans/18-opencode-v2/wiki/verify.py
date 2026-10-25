from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

wiki = Path('/tmp/flow-opencode-v2-plan-wiki')
repo = Path('/Users/vriesd/projects/flow-opencode')
evidence = Path('/tmp/flow-v2-wiki-draft')
baseline = json.loads((evidence / 'baseline.json').read_text())
expected = {p['page'] for p in baseline['pages']}
actual = {p.name for p in wiki.glob('*.md')}
assert actual == expected, (expected - actual, actual - expected)
assert subprocess.check_output(['git', '-C', str(wiki), 'rev-parse', 'HEAD'], text=True).strip() == baseline['baseSHA']
checks = []
issues = []
selected = set(sys.argv[1:]) or actual
assert selected <= actual
for page in sorted(selected):
    body = (wiki / page).read_text()
    for label, raw in re.findall(r'\[([^\]]+)\]\(([^\s)]+)\)', body):
        parsed = urlsplit(raw)
        fragment = unquote(parsed.fragment)
        path = unquote(parsed.path)
        record = {'page': page, 'label': label, 'url': raw}
        if parsed.scheme:
            prefix = '/ddv1982/flow-opencode/blob/main/'
            if parsed.netloc == 'github.com' and path.startswith(prefix):
                relative = path[len(prefix):]
                target = repo / relative
                record.update(kind='local-canonical', target=relative, publicReadback='pending after verified release')
            elif parsed.netloc == 'github.com' and path.startswith('/ddv1982/flow-opencode/commit/'):
                commit = path.rsplit('/', 1)[1]
                result = subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', commit + '^{commit}'], capture_output=True)
                record.update(kind='historical-commit', status='pass' if result.returncode == 0 else 'fail')
                checks.append(record)
                if result.returncode: issues.append(record)
                continue
            else:
                record.update(kind='external-unverified', status='unverified')
                checks.append(record)
                issues.append(record)
                continue
        else:
            name = path or Path(page).stem
            target = wiki / (name if name.endswith('.md') else name + '.md')
            record.update(kind='wiki', target=target.name)
        exists = target.is_file()
        anchor_ok = True
        if exists and fragment:
            anchors = []
            counts = {}
            for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', target.read_text(), re.M):
                heading = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', heading)
                slug = ''.join(c for c in heading.lower() if c in ' -_' or unicodedata.category(c)[0] in 'LN')
                slug = slug.replace(' ', '-')
                number = counts.get(slug, 0)
                counts[slug] = number + 1
                anchors.append(slug + (f'-{number}' if number else ''))
            anchor_ok = fragment in anchors
        record.update(exists=exists, anchor=fragment or None, anchorExists=anchor_ok, status='pass' if exists and anchor_ok else 'fail')
        if exists: record['targetSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        checks.append(record)
        if record['status'] != 'pass': issues.append(record)
    for code in re.findall(r'`([^`\n]+)`', body):
        if re.match(r'^(src|skills|tests|docs)/', code) and not any(c in code for c in '* <>|'):
            record = {'page': page, 'kind': 'source-reference', 'target': code, 'status': 'pass' if (repo / code.rstrip('/')).exists() else 'fail'}
            checks.append(record)
            if record['status'] != 'pass': issues.append(record)
    banned = re.findall(r'[\u2013\u2014]|src/runtime/|src/adapters/|src/distribution/|src/cli\.ts|npx\s|finalReviewPolicy|FLOW_EXPERIMENTAL_COMPACTION|opencode-instructions\.md', body)
    if banned: issues.append({'page': page, 'kind': 'retired-instruction-or-style', 'matches': banned})
inventory_file = evidence / 'inventory.json'
if inventory_file.exists():
    inventory = json.loads(inventory_file.read_text())
    if {p['oldPage'] for p in inventory['pages']} != actual:
        issues.append({'kind': 'inventory-coverage', 'status': 'fail'})
    for item in inventory['pages']:
        digest = hashlib.sha256((wiki / item['oldPage']).read_bytes()).hexdigest()
        if digest != item['updatedSha256']:
            issues.append({'kind': 'inventory-stale', 'page': item['oldPage'], 'status': 'fail'})
result = {'baseSHA': baseline['baseSHA'], 'pageCount': len(actual), 'checkedPages': sorted(selected), 'verificationScope': 'Local file and anchor resolution only. No network requests.', 'status': 'PASS' if not issues else 'ISSUES', 'checkCount': len(checks), 'issues': issues, 'checks': checks, 'publicReadbackGate': 'After verified Flow 10.0.0 release, parent confirms public main README/docs match the released source and all linked paths/anchors. After parent publication, read back all 44 content pages and rendered sidebar navigation. This local verification does not satisfy that gate.'}
(evidence / 'linkverification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['status', 'pageCount', 'checkCount', 'issues']}, indent=2))
raise SystemExit(bool(issues))
