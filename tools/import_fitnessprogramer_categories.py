#!/usr/bin/env python3
"""Import one FitnessProgramer muscle category using the reviewed Chest schema.

Run from repository root with one canonical source category slug.
No inference across metadata fields; exercise-page values are authoritative.
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from import_fitnessprogramer_chest import ROOT, category, exercise, read

CATEGORIES = (
    'neck', 'trapezius', 'shoulders', 'back', 'erector-spinae',
    'biceps', 'triceps', 'forearm', 'abs', 'leg', 'calf', 'hip',
    'cardio', 'full-body',
)
NEXT_PATH = re.compile(r'^/exercise-primary-muscle/([a-z-]+)/page/(\d+)/?$')
NAMELESS = {'Home', 'Exercises', 'Search', 'Login / Reg', 'Cart', 'Menu'}


def next_page(html, slug, page):
    soup = BeautifulSoup(html, 'html.parser')
    for anchor in soup.find_all('a', href=True):
        path = urlparse(urljoin(ROOT, anchor['href'])).path
        match = NEXT_PATH.fullmatch(path)
        if match and match.group(1) == slug and int(match.group(2)) == page + 1:
            return True
    return False


def validate_record(entry, url):
    if entry.get('source_url') != url:
        raise RuntimeError('Source URL mismatch: ' + url)
    if not isinstance(entry.get('name'), str) or not entry['name'].strip():
        raise RuntimeError('Missing name: ' + url)
    gif = entry.get('gif_url')
    if not isinstance(gif, str) or not re.search(r'\.gif(?:$|[?#])', gif, re.I):
        raise RuntimeError('Missing GIF URL: ' + url)
    if urlparse(gif).hostname != urlparse(ROOT).hostname:
        raise RuntimeError('Unexpected GIF host: ' + url)
    if not isinstance(entry.get('how_to'), str):
        raise RuntimeError('how_to is not a string: ' + url)
    if re.search(r'(?im)^(?:preview|muscle groups|equipment|workout planner'
                 r'|coach tips|tips for proper form|frequently asked questions)\s*:?\s*$',
                 entry['how_to']):
        raise RuntimeError('Page furniture in how_to: ' + url)
    muscles = entry.get('muscles', {})
    targets = muscles.get('target', [])
    if not isinstance(targets, list) or any(x in NAMELESS for x in targets):
        raise RuntimeError('Page navigation in muscle target: ' + url)


def run(slug):
    base = f'{ROOT}/exercise-primary-muscle/{slug}/'
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (compatible; MezfitCatalogueImport/1.0)',
        'Accept': 'text/html',
    })
    session.mount('https://', HTTPAdapter(max_retries=Retry(
        total=4, status_forcelist=[429, 500, 502, 503, 504], backoff_factor=2
    )))
    cards = {}
    pages = 0
    for page in range(1, 101):
        url = base if page == 1 else f'{base}page/{page}/'
        html = read(session, url)
        found = category(html)
        if not found:
            raise RuntimeError(f'No exercise cards on {url}')
        overlap = set(cards).intersection(found)
        if overlap:
            raise RuntimeError(f'Duplicate exercise URLs on {url}: {sorted(overlap)}')
        cards.update(found)
        pages = page
        print(f'CATEGORY {slug} page {page}: {len(found)} items; total {len(cards)}', flush=True)
        if not next_page(html, slug, page):
            break
    else:
        raise RuntimeError(f'Exceeded 100 category pages: {slug}')
    if not cards:
        raise RuntimeError(f'Empty category: {slug}')

    destination = Path('assets/exercises') / slug
    destination.mkdir(parents=True, exist_ok=True)
    results = {}
    for i, (url, card) in enumerate(cards.items(), 1):
        path_slug = urlparse(url).path.rstrip('/').split('/')[-1]
        if not re.fullmatch(r'[a-z0-9-]+', path_slug):
            raise RuntimeError('Unexpected exercise slug: ' + url)
        html = read(session, url)
        data = exercise(html, url, card)
        validate_record(data, url)
        filename = path_slug + '.json'
        if filename in results:
            raise RuntimeError('Duplicate exercise filename: ' + filename)
        results[filename] = data
        print(f'CATEGORY {slug}: {i}/{len(cards)} {path_slug}', flush=True)

    if len(results) != len(cards):
        raise RuntimeError(f'Incomplete exercise count in {slug}')
    existing = list(destination.glob('*.json'))
    obsolete = [p for p in existing if p.name != '_manifest.json' and p.name not in results]
    if obsolete:
        raise RuntimeError('Existing files absent from source; refusing deletion: ' +
                           ', '.join(p.name for p in obsolete))
    for filename, data in results.items():
        (destination / filename).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
    manifest = {
        'source': base,
        'count': len(results),
        'listing_pages': pages,
        'imported_at': datetime.now(timezone.utc).isoformat(),
        'missing_gif': [],
        'missing_how_to': [name for name, item in results.items()
                           if not item['how_to']],
        'instructions': 'Full post-GIF instruction text; source HTML list structure.',
    }
    (destination / '_manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print('FINISHED', json.dumps({
        'category': slug, 'count': manifest['count'], 'pages': pages,
        'missing_how_to': len(manifest['missing_how_to'])
    }), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('category', choices=CATEGORIES)
    args = parser.parse_args()
    run(args.category)


if __name__ == '__main__':
    main()
