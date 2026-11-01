"""Behavioral checks for GIF matching and permanent snapshot constraints."""
from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image, ImageDraw

import compare
import download_r2


def make_gif(path: Path, *, size: int, phase: int = 0, mark: bool = False, different: bool = False):
    frames = []
    for step in range(16):
        frame = Image.new("RGB", (size, size), "white")
        draw = ImageDraw.Draw(frame)
        position = (step + phase) % 16
        if different:
            draw.ellipse((size // 3, position * size // 20, 2 * size // 3,
                          position * size // 20 + size // 6), fill="black")
        else:
            draw.rectangle((position * size // 20, size // 3,
                            position * size // 20 + size // 6, 2 * size // 3), fill="black")
        if mark:
            draw.text((size - 15, size - 10), "W", fill="black")
        frames.append(frame)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=80, loop=0)


class MatchingTests(unittest.TestCase):
    def test_same_animation_with_different_size_watermark_and_phase_scores_better(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            a, b, c = base / "a.gif", base / "b.gif", base / "c.gif"
            make_gif(a, size=160)
            make_gif(b, size=240, phase=5, mark=True)
            make_gif(c, size=240, different=True)
            x, y, z = (compare.fingerprint(path) for path in (a, b, c))
            same, _, _ = compare.compare_pair(x, y)
            other, _, _ = compare.compare_pair(x, z)
            self.assertGreater(same, other)
            self.assertGreater(compare.best_phase(x, y)[0], compare.best_phase(x, z)[0])

    def test_one_to_one_matching_never_forces_unrelated_gifs(self):
        matches, reviews, only_r2, only_github = compare.classify(
            3, 3, {(0, 0): 0.97, (1, 1): 0.96, (1, 0): 0.63, (2, 2): 0.20})
        self.assertEqual({(i, j) for i, j, _ in matches}, {(0, 0), (1, 1)})
        self.assertEqual(only_r2, [2])
        self.assertEqual(only_github, [2])
        self.assertEqual(reviews, [])

    def test_ambiguous_near_matches_are_not_automatically_accepted(self):
        matches, reviews, r2_only, _ = compare.classify(
            1, 2, {(0, 0): 0.94, (0, 1): 0.93})
        self.assertEqual(matches, [])
        self.assertEqual(len(reviews), 2)
        self.assertEqual(r2_only, [])

    def test_unmatched_gif_similar_to_matched_partner_stays_in_review(self):
        matches, reviews, r2_only, github_only = compare.classify(
            2, 1, {(0, 0): 0.97, (1, 0): 0.74})
        self.assertEqual({(i, j) for i, j, _ in matches}, {(0, 0)})
        self.assertEqual({(i, j) for i, j, _ in reviews}, {(1, 0)})
        self.assertEqual(r2_only, [])
        self.assertEqual(github_only, [])

    def test_media_inventory_is_pinned_and_unique(self):
        revision, ids = download_r2.approved_keys()
        self.assertEqual(len(revision), 40)
        self.assertEqual(len(ids), 1324)
        self.assertEqual(len(set(ids)), len(ids))
        self.assertTrue(all(len(value) == 4 for value in ids))

    def test_gif_validation_checks_actual_bytes(self):
        with TemporaryDirectory() as tmp:
            valid = Path(tmp) / "ok.gif"
            invalid = Path(tmp) / "broken.gif"
            make_gif(valid, size=96)
            invalid.write_text("not a gif")
            record = download_r2.validate_gif(valid)
            self.assertEqual(record["name"], "ok.gif")
            with self.assertRaises(ValueError):
                download_r2.validate_gif(invalid)


if __name__ == "__main__":
    unittest.main()
