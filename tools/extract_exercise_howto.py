#!/usr/bin/env python3
"""Read complete instruction text after an exercise GIF, preserving lists and breaks."""
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


def _letters(number):
    result = ""
    while number > 0:
        number, digit = divmod(number - 1, 26)
        result = chr(ord("a") + digit) + result
    return result


def _roman(number):
    if number < 1 or number > 3999:
        return str(number)
    parts = ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
             (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
             (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"))
    answer = ""
    for amount, letters in parts:
        while number >= amount:
            answer += letters
            number -= amount
    return answer


def _list_marker(item):
    parent = item.find_parent(("ol", "ul"))
    if parent is None or parent.name == "ul":
        return "-"
    children = parent.find_all("li", recursive=False)
    if not children or item not in children:
        return "-"
    reversed_order = parent.has_attr("reversed")
    direction = -1 if reversed_order else 1
    try:
        value = int(parent["start"]) if parent.has_attr("start") else (
            len(children) if reversed_order else 1)
    except (ValueError, TypeError):
        value = len(children) if reversed_order else 1
    for child in children:
        if child.has_attr("value"):
            try:
                value = int(child["value"])
            except (TypeError, ValueError):
                pass
        if child is item:
            kind = parent.get("type", "1")
            if kind == "a":
                return _letters(value) + "." if value > 0 else str(value) + "."
            if kind == "A":
                return _letters(value).upper() + "." if value > 0 else str(value) + "."
            if kind == "i":
                return _roman(value).lower() + "."
            if kind == "I":
                return _roman(value) + "."
            return str(value) + "."
        value += direction
    return "-"


def extract_how_to(html, gif_url):
    """Return text after the given GIF up to the first explicit section boundary."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.select_one("article") or soup
    image = find_image(root, gif_url)
    if image is None:
        return ""
    # Keep the traversal inside the exercise content when possible.
    article = image.find_parent("article")
    content = image.find_parent(class_=re.compile(r"(?:entry-content|post-content|article-content)"))
    root = content or article or root

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
    marked_items = set()
    for block, depth, fragments in blocks:
        value = " ".join("".join(fragments).split())
        if not value:
            if lines and lines[-1] != "":
                lines.append("")
            continue

        # A literal text bullet is a bullet even outside an HTML list.
        bullet = re.match(r"^[•◦▪●○∙‣⁃]\s*", value)
        if bullet:
            value = value[bullet.end():].lstrip()

        item = block if block.name == "li" else block.find_parent("li")
        if item is not None:
            indent = "  " * max(depth - 1, 0)
            identity = id(item)
            if identity not in marked_items:
                marked_items.add(identity)
                marker = _list_marker(item)
                # Avoid rendering the same marker twice if present in the
                # HTML text as well as in the list structure.
                if not (marker != "-" and value.startswith(marker + " ")):
                    value = marker + " " + value
            else:
                # Continuation paragraphs inside one <li> are not new bullets.
                indent += "  "
            lines.append(indent + value)
        elif bullet:
            lines.append("- " + value)
        else:
            lines.append(value)

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
