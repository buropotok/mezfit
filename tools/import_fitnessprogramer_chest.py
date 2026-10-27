#!/usr/bin/env python3
"""Import Chest exercise metadata as individual JSON files; instruction excerpts are short."""
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag
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
    starts = [
        i for i, value in enumerate(rows)
        if (re.search(r'\bmuscles?\s+worked\b', value, re.I)
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


# These headings end the exercise instructions even when nested deeper than
# their "How to" heading. In particular, the preview/sidebar never contains steps.
INSTRUCTION_BOUNDARY = re.compile(
    r'^(?:preview|muscle groups?|equipment|print exercise|'
    r'workout planner(?: app)?|about us|tips for|common mistakes|'
    r'benefits?|variations?|frequently asked|faqs?|how to incorporate)\b',
    re.I
)


def instruction_excerpt(soup):
    """Extract brief excerpts from explicit instructions only, never sidebar text."""
    main = soup.select_one('main') or soup
    for heading in main.find_all(['h2', 'h3', 'h4']):
        title = heading.get_text(' ', strip=True)
        if not re.search(
            r'^how\s+to\s+(?:do|perform|use|execute)\b|^instructions\b|^execution\b',
            title, re.I
        ):
            continue
        instructions = []
        depth = int(heading.name[1])
        for node in heading.next_elements:
            if not isinstance(node, Tag):
                continue
            if node.name in ('h2', 'h3', 'h4', 'h5', 'h6'):
                label = node.get_text(' ', strip=True)
                if INSTRUCTION_BOUNDARY.match(label):
                    break
                if int(node.name[1]) <= depth:
                    break
            if node.name not in ('p', 'li') or node.find(['p', 'li']) is not None:
                continue
            value = node.get_text(' ', strip=True)
            if value and value not in instructions:
                instructions.append(value)
        # No headings/paragraphs from the article sidebar can fill this field.
        out = []
        budget = 24
        for statement in instructions:
            if INSTRUCTION_BOUNDARY.match(statement):
                break
            words = statement.split()
            if not words or budget <= 0:
                break
            value = ' '.join(words[:budget])
            budget -= len(value.split())
            out.append({'step': len(out) + 1, 'instructions': [value]})
        return out
    return []

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
        'how_to': instruction_excerpt(soup),
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
        fresh = exercise(read(session, url), url, card)
        results[slug + '.json'] = fresh
        print(f'{i}/{len(cards)} {slug}', flush=True)
    if len(results) != len(cards) or any(not x['name'] or not x['gif_url'] for x in results.values()):
        raise RuntimeError('Missing required name or GIF URL, or duplicate exercise filenames')
    # Check source-backed examples; never populate missing muscles from muscle_group.
    cobra = results.get('cobra-push-up.json', {})
    if (cobra.get('how_to') != []
            or cobra.get('muscles', {}).get('target') != []
            or cobra.get('muscles', {}).get('synergists') != []):
        raise RuntimeError('Cobra Push-up image-only regression')
    for filename, record in results.items():
        for instruction in record.get('how_to', []):
            for paragraph in instruction.get('instructions', []):
                if (paragraph.strip().lower() in ('chest', 'full gym', 'no equipment')
                        or 'online workout planner' in paragraph.lower()):
                    raise RuntimeError('Unrelated text captured as an instruction: ' + filename)
    bench = results.get('bench-press.json', {})
    cable = results.get('high-cable-crossover.json', {})
    arm = results.get('arm-scissors.json', {})
    if ('Pectoralis Major, Sternal' not in bench.get('muscles', {}).get('target', [])
            or not bench.get('muscles', {}).get('synergists', [])
            or not cable.get('muscles', {}).get('synergists', [])
            or 'Trapezius' not in arm.get('muscles', {}).get('target', [])
            or not results.get('pec-deck-fly.json', {}).get('how_to')
            or 'Frequently Asked Questions' in results.get('pec-deck-fly.json', {}).get('muscles', {}).get('target', [])):
        raise RuntimeError('Muscle parsing regression: ' + repr({
            'cobra': cobra.get('muscles'),
            'bench': bench.get('muscles'),
            'cable': cable.get('muscles'),
            'arm': arm.get('muscles'),
            'pec_deck_has_how_to': bool(results.get('pec-deck-fly.json', {}).get('how_to')),
        }))
    for filename, data in results.items():
        invalid = [name for name in data['muscles']['target'] if STOP.match(name)]
        if invalid:
            raise RuntimeError('Muscle label contamination in ' + filename + ': ' + repr(invalid))
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
            'instructions': 'Brief excerpts only; full text available at source_url.'}
    (folder / '_manifest.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(meta, indent=2), flush=True)


if __name__ == '__main__':
    main()
