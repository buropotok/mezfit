#!/usr/bin/env python3
"""Import Chest metadata and complete post-GIF exercise instructions."""
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

from extract_exercise_howto import extract_how_to
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = 'https://fitnessprogramer.com'
LIST = ROOT + '/exercise-primary-muscle/chest/'
EXERCISE = re.compile(r'^/exercise/[a-z0-9-]+/$', re.I)
GIF = re.compile(r'/wp-content/uploads/[^\s\"\'<>]+?\.gif', re.I)
MUSCLE = re.compile(r'^(Target|Synergists?|Dynamic Stabilizers?|Antagonist Stabilizers?|Stabilizers?)\s*[-:–]\s*(.+)$', re.I)
STOP = re.compile(r'^(Preview|Frequently Asked Questions|Muscle Groups?|Equipment|Benefits?|Variations?|FAQ|How To|Workout Planner|Print Exercise)', re.I)


def uniq(values):
    return list(dict.fromkeys(v.strip(' -–:,') for v in values if v.strip(' -–:,')))


def read(session, url):
    if urlparse(url).hostname != 'fitnessprogramer.com':
        raise ValueError('Disallowed hostname: ' + url)
    response = session.get(url, timeout=(15, 40))
    response.raise_for_status()
    if 'html' not in response.headers.get('Content-Type', 'text/html').lower():
        raise ValueError('Non-HTML response: ' + url)
    time.sleep(0.35)
    return response.text


def category(html):
    soup = BeautifulSoup(html, 'html.parser')
    main = soup.select_one('main') or soup
    result = {}
    for h in main.find_all(['h2', 'h3', 'h4']):
        a = h.find('a', href=True)
        if not a:
            continue
        url = urljoin(ROOT, a['href'])
        if urlparse(url).hostname != 'fitnessprogramer.com' or not EXERCISE.fullmatch(urlparse(url).path):
            continue
        attrs = {'name': h.get_text(' ', strip=True), 'equipment': [], 'muscle_group': []}
        for p in list(h.parents)[:5]:
            text = p.get_text(' ', strip=True)
            if len(text) > 1600:
                continue
            eq = re.search(r'Equipment:\s*(.*?)\s*Primary Muscles:', text, re.I)
            group = re.search(r'Primary Muscles:\s*(.*?)(?:View Details|$)', text, re.I)
            if eq and group:
                attrs['equipment'] = uniq(eq.group(1).split(','))
                attrs['muscle_group'] = uniq(group.group(1).split(','))
                break
        result[url.rstrip('/') + '/'] = attrs
    return result


def section(soup, pattern):
    main = soup.select_one('main') or soup
    for heading in main.find_all(['h2', 'h3', 'h4']):
        if not re.search(pattern, heading.get_text(' ', strip=True), re.I):
            continue
        nodes = []
        for node in heading.next_siblings:
            if isinstance(node, Tag):
                if node.name in ['h2', 'h3', 'h4'] and int(node.name[1]) <= int(heading.name[1]):
                    if node.find('img') is not None or node.get_text(' ', strip=True).lower().startswith('image:'):
                        continue
                    break
                nodes.append(node)
        if nodes:
            return nodes
    return []


def extract_metadata(soup, heading_text, fallback):
    main = soup.select_one('main') or soup
    candidates = [h for h in main.find_all(['h2', 'h3', 'h4']) if h.get_text(' ', strip=True).lower() == heading_text.lower()]
    for h in reversed(candidates):
        values = []
        for node in h.next_siblings:
            if isinstance(node, Tag):
                if node.name in ['h2', 'h3', 'h4']:
                    break
                values += [x.get_text(' ', strip=True) for x in node.find_all('li')]
                if node.name == 'li':
                    values.append(node.get_text(' ', strip=True))
        if values:
            return uniq(values)
    return fallback


def extract_muscles(soup):
    """Extract role-labelled or unlabelled names only under 'Muscles Worked'."""
    result = {'target': [], 'synergists': [],
              'stabilizers': {'dynamic': [], 'antagonist': []}}
    main = soup.select_one('main') or soup
    rows = [' '.join(x.split()).strip('• ') for x in main.get_text('\n', strip=True).splitlines()]
    title = soup.find('h1')
    if title is None:
        return result
    exercise_name = title.get_text(' ', strip=True)
    h1_position = next((i for i, row in enumerate(rows) if row == exercise_name), -1)
    if h1_position < 0:
        return result
    starts = [
        i for i, value in enumerate(rows)
        if (i > h1_position
            and re.search(r'\bmuscles?\s+worked\b', value, re.I)
            and len(value) < 90
            and not re.match(r'^(?:image:|overview|preview)', value, re.I)
            and not re.search(r'[.!?]', value))
    ]
    if not starts:
        # No list of worked muscles: not even a muscle-group fallback.
        return result

    # Prefer the final actual section heading if the page has references earlier.
    lines = []
    start = starts[-1]
    for value in rows[start + 1: start + 80]:
        if STOP.match(value) or re.search(r'\b(how can you incorporate|related exercises)\b', value, re.I):
            break
        lines.append(value)
    labeled = False
    unlabeled = []
    i = 0
    while i < len(lines):
        value = lines[i]
        found = None
        consumed = 1
        for n in (1, 2, 3):
            candidate = ' '.join(lines[i:i + n])
            match = MUSCLE.fullmatch(candidate)
            if match:
                found = match
                consumed = n
                break
        if found:
            labeled = True
            role, muscle = found.groups()
            role = role.lower()
            if role.startswith('target'):
                result['target'].append(muscle)
            elif role.startswith('synergist'):
                result['synergists'].append(muscle)
            elif role.startswith('antagonist'):
                result['stabilizers']['antagonist'].append(muscle)
            else:
                result['stabilizers']['dynamic'].append(muscle)
            i += consumed
            continue
        # Plain, standalone muscle names without role labels are targets only
        # when this section contains no role labels at all.
        if (value and len(value) < 70 and len(value.split()) <= 6
                and not re.search(r'[.:?!]', value)
                and not re.match(r'^(?:image|target|synergists?|stabilizers?)$', value, re.I)
                and all(word[:1].isupper() or word.lower() in ('of', 'and', 'the')
                        for word in value.replace(',', ' ').replace('/', ' ').split())):
            unlabeled.append(value)
        i += 1
    if not labeled:
        result['target'] = uniq(unlabeled)
    else:
        result['target'] = uniq(result['target'])
    result['synergists'] = uniq(result['synergists'])
    for role in result['stabilizers']:
        result['stabilizers'][role] = uniq(result['stabilizers'][role])
    return result


def get_gif(html, soup, slug):
    candidates = []
    main = soup.select_one('main') or soup
    for el in main.find_all(['img', 'source', 'a']):
        for key in ('href', 'data-src', 'data-lazy-src', 'src', 'data-srcset', 'srcset'):
            for m in GIF.finditer(el.get(key, '')):
                candidates.append(urljoin(ROOT, m.group()))
    if not candidates:
        candidates = [urljoin(ROOT, m.group()) for m in GIF.finditer(html.replace('\\/', '/'))]
    candidates = uniq(candidates)
    tokens = set(slug.split('-')) - {'the', 'and', 'with', 'to'}
    return max(candidates, key=lambda u: sum(k in urlparse(u).path.lower() for k in tokens), default=None)


def exercise(html, url, card):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    group = extract_metadata(soup, 'Muscle Groups', [])
    return {
        'source_url': url,
        'name': h1.get_text(' ', strip=True) if h1 else card['name'],
        'how_to': extract_how_to(html, get_gif(html, soup, urlparse(url).path.strip('/').split('/')[-1]) or ''),
        'gif_url': get_gif(html, soup, urlparse(url).path.strip('/').split('/')[-1]),
        'muscles': extract_muscles(soup),
        'equipment': extract_metadata(soup, 'Equipment', []),
        'muscle_group': group,
    }


def main():
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0 (compatible; MezfitCatalogueImport/1.0)', 'Accept': 'text/html'})
    session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, status_forcelist=[429, 500, 502, 503, 504], backoff_factor=2)))
    cards = {}
    count_pages = 0
    for page in range(1, 21):
        url = LIST if page == 1 else f'{LIST}page/{page}/'
        found = category(read(session, url))
        if not found:
            break
        count_pages += 1
        cards.update(found)
        print('Listing', page, len(found), flush=True)
        if page > 1 and len(found) < 10:
            break
    if len(cards) < 100:
        raise RuntimeError('Catalogue incomplete; found only ' + str(len(cards)))
    results = {}
    for i, (url, card) in enumerate(cards.items(), 1):
        slug = urlparse(url).path.rstrip('/').split('/')[-1]
        html = read(session, url)
        existing_path = Path('assets/exercises/chest') / (slug + '.json')
        if existing_path.is_file():
            # Existing non-instruction metadata is authoritative for this import.
            saved = json.loads(existing_path.read_text(encoding='utf-8'))
            if saved.get('source_url') != url:
                raise RuntimeError('Source URL mismatch: ' + slug)
            if not saved.get('name') or not saved.get('gif_url'):
                raise RuntimeError('Required fields missing: ' + slug)
            saved['how_to'] = extract_how_to(html, saved['gif_url'])
            results[slug + '.json'] = saved
        else:
            results[slug + '.json'] = exercise(html, url, card)
        print(f'{i}/{len(cards)} {slug}', flush=True)
    if len(results) != len(cards) or any(not x['name'] or not x['gif_url'] for x in results.values()):
        raise RuntimeError('Missing required name or GIF URL, or duplicate exercise filenames')
    # Regression sentinels from visibly different source layouts.
    cobra = results.get('cobra-push-up.json', {})
    bench = results.get('bench-press.json', {})
    cable = results.get('high-cable-crossover.json', {})
    arm = results.get('arm-scissors.json', {})
    pec_deck = results.get('pec-deck-fly.json', {})
    if cobra.get('how_to') != '' or cobra.get('muscles', {}).get('target') != []:
        raise RuntimeError('Cobra Push-up must have empty instruction and muscles')
    bench_text = bench.get('how_to', '')
    if not all(part in bench_text for part in
               ('1. Setup', '2. Unrack and Descent',
                '3. Press Phase', '4. Reset and Repeat')):
        raise RuntimeError('Bench Press instruction must retain ordered stage numbers')
    if not re.search(r'(?m)^  - Lie on a flat bench', bench_text):
        raise RuntimeError('Bench Press nested unordered bullets missing')
    incline_text = results.get('incline-dumbbell-fly.json', {}).get('how_to', '')
    if not ('Setup\n\n1. Adjust' in incline_text
            and 'Execution\n\n1. Inhale' in incline_text):
        raise RuntimeError('Incline Dumbbell Fly headings or ordered list structure lost')
    cable_text = cable.get('how_to', '')
    if not ('1. Adjust the cables' in cable_text
            and '7. Repeat' in cable_text
            and 'Coach Tips' not in cable_text):
        raise RuntimeError('High Cable Crossover instruction incomplete or contaminated')
    if not pec_deck.get('how_to'):
        raise RuntimeError('Pec Deck Fly instruction missing')
    if ('Pectoralis Major, Sternal' not in bench['muscles']['target']
            or not bench['muscles']['synergists']
            or not cable['muscles']['synergists']
            or 'Trapezius' not in arm['muscles']['target']):
        raise RuntimeError('Previously verified muscle metadata changed')
    for filename, data in results.items():
        text = data['how_to']
        if not isinstance(text, str):
            raise RuntimeError('how_to must be a string in ' + filename)
        if re.search(r'(?im)^(?:preview|muscle groups|equipment|workout planner'
                     r'|coach tips|tips for proper form|frequently asked questions)\s*:?\s*$',
                     text):
            raise RuntimeError('Unrelated section included in ' + filename)
        if not data.get('name') or not data.get('gif_url'):
            raise RuntimeError('Required fields missing in ' + filename)
    folder = Path('assets/exercises/chest')
    folder.mkdir(parents=True, exist_ok=True)
    for path in folder.glob('*.json'):
        if path.name != '_manifest.json' and path.name not in results:
            path.unlink()
    for name, data in results.items():
        (folder / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    meta = {'source': LIST, 'count': len(results), 'listing_pages': count_pages,
            'imported_at': datetime.now(timezone.utc).isoformat(),
            'missing_gif': [n for n, x in results.items() if not x['gif_url']],
            'missing_how_to': [n for n, x in results.items() if not x['how_to']],
            'instructions': 'Full post-GIF instruction text with original paragraph/list structure.'}
    (folder / '_manifest.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(meta, indent=2), flush=True)


if __name__ == '__main__':
    main()
