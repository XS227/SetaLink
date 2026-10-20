#!/usr/bin/env python3
"""Install a verified APK and update only Android download links on the live pages."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--apk', type=Path, required=True)
parser.add_argument('--sha256', required=True)
parser.add_argument('--version', required=True)
args = parser.parse_args()
assert re.fullmatch(r'\d+\.\d+\.\d+', args.version), 'Invalid version'
assert re.fullmatch(r'[a-f0-9]{64}', args.sha256), 'Invalid SHA-256'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


assert digest(args.apk) == args.sha256, 'APK integrity mismatch'
canonical = 'https://github.com/XS227/SetaLink/releases/latest/download/RealGram-latest.apk'
apk_name = f'RealGram-{args.version}.apk'
updates = []
for language, name in [('en', 'index.html'), ('fa', 'fa/index.html')]:
    path = args.root / name
    original = path.read_text()
    updated = original.replace('"/download/RealGram-latest.apk"', f'"{canonical}"')
    suffix = '_FA' if language == 'fa' else ''
    label = 'آخرین نسخه · APK مستقیم' if language == 'fa' else 'Latest version · direct APK'
    pattern = rf'<!-- VERSION_START{suffix} -->.*?<!-- VERSION_END{suffix} -->'
    replacement = f'<!-- VERSION_START{suffix} --><span class="platform-dl-version">{label}</span><!-- VERSION_END{suffix} -->'
    updated, count = re.subn(pattern, lambda _: replacement, updated, flags=re.S)
    assert count == 1, f'Download version block missing in {name}'
    version_label = args.version.translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')) if language == 'fa' else args.version
    fallback_label = f'دانلود جایگزین اندروید ({version_label})' if language == 'fa' else f'Alternative Android download (v{version_label})'
    fallback = f'<p id="android-alternative"><a href="/download/{apk_name}">{fallback_label}</a></p>'
    section_match = re.search(r'<section\s+id="get"[^>]*>.*?</section>', updated, re.S)
    assert section_match, f'Download section missing in {name}'
    section = section_match.group()
    if 'id="android-alternative"' in section:
        section = re.sub(r'<p id="android-alternative">.*?</p>', lambda _: fallback, section, flags=re.S)
    else:
        pos = section.rfind('</div>')
        assert pos >= 0
        section = section[:pos + 6] + '\n    ' + fallback + section[pos + 6:]
    updated = updated[:section_match.start()] + section + updated[section_match.end():]
    assert canonical in updated and f'/download/{apk_name}' in updated
    updates.append((path, original, updated, path.stat()))

download_dir = args.root / 'download'
download_dir.mkdir(exist_ok=True)
destination = download_dir / apk_name
if destination.exists():
    assert digest(destination) == args.sha256, 'Published version is immutable'
else:
    staged = download_dir / f'.{apk_name}.{os.getpid()}.tmp'
    shutil.copyfile(args.apk, staged)
    staged.chmod(0o644)
    assert digest(staged) == args.sha256
    staged.replace(destination)

latest = download_dir / 'RealGram-latest.apk'
if latest.exists() and not latest.is_symlink():
    previous = download_dir / f'RealGram-previous-{digest(latest)[:12]}.apk'
    if not previous.exists():
        os.link(latest, previous)
alias = download_dir / f'.latest.{os.getpid()}'
alias.symlink_to(apk_name)
alias.replace(latest)

for path, original, updated, info in updates:
    assert path.read_text() == original, f'Concurrent edit detected in {path.name}'
    temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    temporary.write_text(updated)
    temporary.chmod(stat.S_IMODE(info.st_mode))
    os.chown(temporary, info.st_uid, info.st_gid)
    temporary.replace(path)

print(json.dumps({'version': args.version, 'sha256': digest(latest),
    'pages': [str(path) for path, *_ in updates], 'canonicalDownload': canonical}))
