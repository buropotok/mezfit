"""Regression contracts for empty .gitkeep placeholders in Vite's dist output."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from publish_spa import files_to_publish, publish
from web_hosting import WebHostingError


class SpaGitkeepContracts(unittest.TestCase):
    def make_dist(self, folder):
        root = Path(folder)
        (root / "index.html").write_text("<html>MezFit</html>", encoding="utf-8")
        (root / "assets").mkdir()
        (root / "assets" / "app-12345678.js").write_text("console.log('ok')")
        return root

    def test_empty_gitkeep_in_fonts_and_root_is_not_uploaded(self):
        with TemporaryDirectory() as folder:
            root = self.make_dist(folder)
            (root / "fonts").mkdir()
            (root / "fonts" / ".gitkeep").touch()
            (root / ".gitkeep").touch()

            names = [name for name, _ in files_to_publish(root)]
            self.assertEqual(names, ["assets/app-12345678.js", "index.html"])

            uploaded = []
            publish(root, "website-bucket", "unused",
                    lambda bucket, key, data, headers: uploaded.append(key))
            self.assertEqual(uploaded, names)

    def test_non_empty_gitkeep_is_rejected(self):
        with TemporaryDirectory() as folder:
            root = self.make_dist(folder)
            (root / "fonts").mkdir()
            (root / "fonts" / ".gitkeep").write_text("not a placeholder")
            with self.assertRaisesRegex(WebHostingError, "non-empty .gitkeep"):
                files_to_publish(root)

    def test_hidden_file_inside_hidden_directory_is_rejected(self):
        with TemporaryDirectory() as folder:
            root = self.make_dist(folder)
            (root / ".private").mkdir()
            (root / ".private" / ".gitkeep").touch()
            with self.assertRaisesRegex(WebHostingError, "Refusing hidden"):
                files_to_publish(root)

    def test_env_file_and_source_map_remain_forbidden(self):
        for name in (".env", "assets/app-12345678.js.map"):
            with self.subTest(name=name), TemporaryDirectory() as folder:
                root = self.make_dist(folder)
                (root / name).write_text("secret")
                with self.assertRaisesRegex(WebHostingError, "Refusing hidden or source-map"):
                    files_to_publish(root)

    def test_symlinked_gitkeep_remains_forbidden(self):
        with TemporaryDirectory() as folder:
            root = self.make_dist(folder)
            (root / "fonts").mkdir()
            (root / "fonts" / ".gitkeep").symlink_to(root / "index.html")
            with self.assertRaisesRegex(WebHostingError, "Refusing symlink"):
                files_to_publish(root)

    def test_placeholder_is_not_counted_as_a_real_app_asset(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "index.html").write_text("<html>incomplete</html>")
            (root / "fonts").mkdir()
            (root / "fonts" / ".gitkeep").touch()
            with self.assertRaisesRegex(WebHostingError, "Incomplete SPA build"):
                files_to_publish(root)


if __name__ == "__main__":
    unittest.main()
