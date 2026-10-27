#!/usr/bin/env python3
"""Read the instruction after an exercise GIF in locally supplied HTML.

This utility does not fetch pages or publish copyrighted material. Output is
a single string; paragraphs and nested list bullets are preserved.
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup, NavigableString, Tag

BOUNDARY = re.compile(
    r"^(?:tips\s+for\s+proper\s+form|coach\s+tips|primary\s+muscles?\b|"
    r"muscles?\s+worked\b|preview\b|muscle\s+groups?\b|equipment\b|"
    r"benefits?\b|common\s+mistakes\b|frequently\s+asked\b|faq\b|"
    r"how\s+to\s+incorporate\b|workout\s+planner\b|about\s+us\b|"
    r"print\s+exercise\b)", re.I
)
GIF = re.compile(r"\.gif(?:$|[?#])", re.I)
BLOCKS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"}
EXCLUDED = {"script", "style", "noscript", "svg", "form"}


def sources(tag):
    for attr in ("src", "data-src", "data-lazy-src", "data-original",
                 "srcset", "data-srcset", "href"):
        value = tag.get(attr)
        if isinstance(value, str):
            yield from (s for s in re.split(r"[\s,]+", value) if s)
    if tag.name == "img" and tag.parent and tag.parent.name == "a":
        href = tag.parent.get("href")
        if href:
            yield href


def gif_tag(tag):
    return tag.name in ("img", "source", "a") and any(
        GIF.search(value) for value in sources(tag)
    )


def find_image(root, gif_url):
    basename = urlparse(gif_url).path.rsplit("/", 1)[-1].lower()
    for element in root.find_all("img"):
        if any(urlparse(value).path.rsplit("/", 1)[-1].lower() == basename
               for value in sources(element)):
            return element
    for element in root.find_all(("source", "a")):
        if any(urlparse(value).path.rsplit("/", 1)[-1].lower() == basename
               for value in sources(element)):
            return element
    return None


def extract_how_to(html, gif_url):
    """Return text after the given GIF up to the first explicit section boundary."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.select_one("article") or soup
    image = find_image(root, gif_url)
    if image is None:
        return ""

    blocks = []
    for node in image.next_elements:
        if root is not soup and root not in getattr(node, "parents", ()):
            break
        if isinstance(node, Tag):
            if node.name == "hr":
                break
            if node is not image and gif_tag(node):
                break
            if node.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                if BOUNDARY.match(node.get_text(" ", strip=True)):
                    break
            if node.name == "br" and blocks:
                blocks.append((node, 0, []))
            continue
        if not isinstance(node, NavigableString) or not str(node).strip():
            continue
        if any(parent.name in EXCLUDED for parent in node.parents):
            continue
        if BOUNDARY.match(str(node).strip()) or re.fullmatch(
                r"\s*[-–—_]{4,}\s*", str(node)):
            break
        block = next((p for p in node.parents if p.name in BLOCKS), node.parent)
        if block is None:
            continue
        depth = sum(1 for p in node.parents if p.name == "li")
        if not blocks or blocks[-1][0] is not block:
            blocks.append((block, depth, [str(node)]))
        else:
            blocks[-1][2].append(str(node))

    lines = []
    for block, depth, fragments in blocks:
        value = " ".join("".join(fragments).split())
        if not value:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        prefix = ("  " * max(depth - 1, 0) + "- ") if depth else ""
        lines.append(prefix + value)
        if block.name in ("p", "blockquote") and depth == 0:
            lines.append("")
    return "\n".join(lines).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html_path", type=Path)
    parser.add_argument("--gif-url", required=True)
    args = parser.parse_args()
    html = args.html_path.read_text(encoding="utf-8")
    print(json.dumps({"how_to": extract_how_to(html, args.gif_url)},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
