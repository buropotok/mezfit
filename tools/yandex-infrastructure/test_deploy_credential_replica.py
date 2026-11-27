"""Deployment safeguards without live Yandex calls."""

import contextlib
import io
import os
import unittest
from unittest.mock import Mock, patch

import deploy_credential_replica as deploy
from deploy_browser_auth import YandexHttpError
from web_hosting import WebHostingError


class CredentialDeployContracts(unittest.TestCase):
    def test_preview_has_no_resource_writes_and_requires_no_secret(self):
        env = {
            "YC_FOLDER_ID": "folder", "YC_DEPLOY_SA_ID": "deploy", "YC_IAM_TOKEN": "fixture",
            "CREDENTIAL_REPLICA_MODE": "preview",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(deploy, "request_api") as api, \
                patch.object(deploy, "find", return_value=None) as find, contextlib.redirect_stdout(io.StringIO()) as log:
            deploy.main()
        self.assertEqual(find.call_count, 4)
        api.assert_not_called()
        self.assertIn("Preview only", log.getvalue())

    def test_post_probe_rejects_acceptance_without_sender_secret(self):
        api = Mock(side_effect=YandexHttpError("probe", 401))
        deploy.verify_post_requires_secret(api, "function", "candidate")
        api.assert_called_once_with("https://functions.yandexcloud.net/function?tag=candidate",
                                    "Verify credential POST rejects missing sender secret", {})
        with self.assertRaises(WebHostingError):
            deploy.verify_post_requires_secret(Mock(return_value={"status": "applied"}), "function", "candidate")
