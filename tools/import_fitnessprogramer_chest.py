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
STOP = re.compile(r'^(Preview|Muscle Groups?|Equipment|Benefits?|Variations?|FAQ|How To|Workout Planner|Print Exercise)', re.I)


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


def extract_muscles(soup, fallback):
    nodes = section(soup, r'muscles?\s+(worked|targeted)|muscles?\s+involved')
    text = '\n'.join(n.get_text('\n', strip=True) for n in nodes)
    if not text:
        text = (soup.select_one('main') or soup).get_text('\n', strip=True)
    out = {'target': [], 'synergists': [], 'stabilizers': {'dynamic': [], 'antagonist': []}}
    for row in text.splitlines():
        row = ' '.join(row.split()).strip('• ')
        if STOP.match(row):
            break
        match = MUSCLE.match(row)
        if match:
            label, muscle = match.groups()
            bucket = (out['target'] if label.lower() == 'target' else out['synergists'] if label.lower().startswith('synergist') else out['stabilizers']['antagonist'] if label.lower().startswith('antagonist') else out['stabilizers']['dynamic'])
            bucket.append(muscle)
        elif nodes and row and len(row.split()) <= 5 and len(row) < 65 and not re.search(r'[.:?!]', row):
            out['target'].append(row)
    out['target'] = uniq(out['target'])
    out['synergists'] = uniq(out['synergists'])
    out['stabilizers']['dynamic'] = uniq(out['stabilizers']['dynamic'])
    out['stabilizers']['antagonist'] = uniq(out['stabilizers']['antagonist'])
    if not any([out['target'], out['synergists'], out['stabilizers']['dynamic'], out['stabilizers']['antagonist']]):
        out['target'] = fallback[:]
    return out


def instruction_excerpt(soup):
    nodes = section(soup, r'how\s+to|instructions|execution')
    if not nodes:
        return []
    paragraphs = []
    for n in nodes:
        if n.name in ('ul', 'ol'):
            paragraphs += [li.get_text(' ', strip=True) for li in n.find_all('li', recursive=False)]
        else:
            paragraphs += [x.get_text(' ', strip=True) for x in n.find_all(['p', 'li'], recursive=False)]
            if not n.find(['p', 'li']):
                paragraphs.append(n.get_text(' ', strip=True))
    steps = []
    remaining = 24
    for p in paragraphs:
        if re.match(r'^(here are|the following|follow these|steps to perform)', p.strip(), re.I):
            continue
        words = p.split()
        if not words or remaining == 0:
            continue
        clip = ' '.join(words[:remaining])
        remaining -= len(clip.split())
        steps.append({'step': len(steps) + 1, 'title': 'Instruction excerpt', 'instructions': [clip]})
    return steps


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
    group = extract_metadata(soup, 'Muscle Groups', card['muscle_group'])
    return {
        'source_url': url,
        'name': h1.get_text(' ', strip=True) if h1 else card['name'],
        'how_to': instruction_excerpt(soup),
        'gif_url': get_gif(html, soup, urlparse(url).path.strip('/').split('/')[-1]),
        'muscles': extract_muscles(soup, group),
        'equipment': extract_metadata(soup, 'Equipment', card['equipment']),
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
        results[slug + '.json'] = exercise(read(session, url), url, card)
        print(f'{i}/{len(cards)} {slug}', flush=True)
    if len(results) != len(cards) or sum(bool(x['gif_url']) for x in results.values()) < len(results)*.7:
        raise RuntimeError('Validation failed: duplicate files or too few GIF links')
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
