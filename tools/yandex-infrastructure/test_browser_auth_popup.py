import unittest

from deploy_browser_auth import DIAGNOSTICS_FINGERPRINT, POPUP, POPUP_ROLLBACK, PRE_POPUP_TAG, TAG
from deploy_browser_auth import nonce_bucket_contract
from test_browser_auth_diagnostics_upgrade import UpgradeCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA
from web_hosting import STORAGE, WebHostingError


class PopupCloud(UpgradeCloud):
    def __init__(self):
        super().__init__()
        self.versions[0]['description'] = DIAGNOSTICS_FINGERPRINT
        self.nonce_bucket = None
        self.settings, self.policy = nonce_bucket_contract(FOLDER, RUNTIME_SA)

    def __call__(self, url, label, payload=None):
        name = self.settings['name']
        if url.startswith(STORAGE + '?'):
            return {'buckets': [self.nonce_bucket] if self.nonce_bucket else []}
        if url == STORAGE and payload:
            self.writes.append((url, payload))
            self.nonce_bucket = payload.copy()
            return self.operation({'id': name})
        if url == f'{STORAGE}/{name}?view=VIEW_FULL':
            return self.nonce_bucket
        if url == f'{STORAGE}/{name}:listAccessBindings':
            return {}
        return super().__call__(url, label, payload)

    def update(self, url, label, payload, method):
        if label == 'Install exact nonce bucket policy':
            assert method == 'PUT'
            self.writes.append((url, payload))
            self.nonce_bucket['policy'] = payload
            return {}
        return super().update(url, label, payload, method)


class PopupDeploymentContract(unittest.TestCase):
    def test_preview_apply_idempotence_and_rollback(self):
        cloud = PopupCloud()
        original = cloud.spec
        cloud.execute('preview', 'popup', '')
        self.assertEqual(cloud.writes, [])
        cloud.execute('apply', 'popup', POPUP)
        self.assertEqual(cloud.nonce_bucket['policy'], cloud.policy)
        self.assertEqual(set(cloud.spec['paths']['/auth/start']), {'get', 'post'})
        self.assertEqual(set(cloud.spec['paths']['/auth/callback']), {'get', 'post'})
        self.assertEqual(cloud.spec['paths']['/api/{proxy+}'], original['paths']['/api/{proxy+}'])
        self.assertIn(PRE_POPUP_TAG, cloud.versions[0]['tags'])
        self.assertIn(TAG, cloud.versions[1]['tags'])
        before = len(cloud.writes)
        cloud.execute('apply', 'popup', POPUP)
        self.assertEqual(len(cloud.writes), before)
        cloud.execute('preview', 'popup-rollback', '')
        self.assertEqual(len(cloud.writes), before)
        cloud.execute('apply', 'popup-rollback', POPUP_ROLLBACK)
        self.assertEqual(cloud.spec, original)
        self.assertIn(TAG, cloud.versions[0]['tags'])
        self.assertNotIn(TAG, cloud.versions[1]['tags'])

    def test_public_bucket_drift_and_wrong_confirmation_reject_before_write(self):
        cloud = PopupCloud()
        with self.assertRaisesRegex(WebHostingError, 'confirmation'):
            cloud.execute('apply', 'popup', 'wrong')
        cloud.nonce_bucket = {**cloud.settings, 'anonymousAccessFlags': {'read': True}}
        with self.assertRaisesRegex(WebHostingError, 'private contract'):
            cloud.execute('apply', 'popup', POPUP)
        self.assertEqual(cloud.writes, [])
