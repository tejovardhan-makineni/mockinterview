#!/usr/bin/env python3
"""No-network tests for deployment isolation and reconciliation semantics."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import shlex
import subprocess
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]

class DeployTest(unittest.TestCase):
    def run_helper(self, name, environment, respond, arguments=()):
        calls = []
        def fake_open(request, **_):
            body = json.loads(request.data) if request.data else None
            calls.append((request.method, request.full_url, body))
            return io.BytesIO(json.dumps(respond(request.method, request.full_url, body)).encode())
        def output(command, **_):
            return '12345\n' if command[1:3] == ['projects', 'describe'] else 'fake-access-token\n'
        script = ROOT / 'deploy' / name
        with patch.dict(os.environ, environment, clear=True), patch('sys.argv', [str(script), *arguments]), \
             patch('subprocess.check_output', side_effect=output), patch('urllib.request.urlopen', side_effect=fake_open), \
             patch('ssl.create_default_context', return_value=None), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(script), run_name='__main__')
        return calls

    def test_database_existing_is_noop_and_rotation_is_explicit(self):
        env = {'PROJECT_ID': 'test-project', 'CLOUDSQL_INSTANCE': 'test-project:us-west1:shared',
               'DB_NAME': 'mockinterview', 'DB_USER': 'mockinterview', 'DB_PASSWORD': 'a-strong-test-only-password'}
        def response(method, url, body):
            if method == 'GET' and url.endswith('/users'):
                return {'items': [{'name': 'mockinterview', 'type': 'BUILT_IN'}]}
            if method == 'GET' and url.endswith('/databases'):
                return {'items': [{'name': 'mockinterview'}]}
            if method == 'PUT':
                self.assertNotIn(env['DB_PASSWORD'], url)
                self.assertEqual(body['password'], env['DB_PASSWORD'])
                return {'status': 'DONE'}
            self.fail('Unexpected operation: '+method+' '+url)
        calls = self.run_helper('setup-db.py', env, response)
        self.assertTrue(all(method == 'GET' for method, _, _ in calls))
        calls = self.run_helper('setup-db.py', env, response, ['--rotate-password'])
        self.assertEqual(sum(method == 'PUT' for method, _, _ in calls), 1)

    def test_monitor_updates_paged_existing_checks_and_channel(self):
        env = {'PROJECT_ID': 'test-project', 'PUBLIC_URL': 'https://practice.example.com',
               'WEB_API_BASE': 'https://api.example.com', 'MONITORING_NOTIFICATION_CHANNEL': 'projects/12345/notificationChannels/new'}
        def response(method, url, body):
            parsed = urlparse(url)
            if '/notificationChannels/' in parsed.path:
                return {'enabled': True, 'verificationStatus': 'VERIFIED'}
            if method == 'GET' and parsed.path.endswith('/uptimeCheckConfigs'):
                if not parse_qs(parsed.query).get('pageToken'):
                    return {'uptimeCheckConfigs': [{'displayName': 'Other app', 'name': 'projects/12345/uptimeCheckConfigs/other'}], 'nextPageToken': 'second'}
                return {'uptimeCheckConfigs': [{'displayName': 'Mockinterview '+kind, 'name': 'projects/12345/uptimeCheckConfigs/'+kind.lower()} for kind in ['Web', 'API']]}
            if method == 'GET' and parsed.path.endswith('/alertPolicies'):
                return {'alertPolicies': [{'displayName': 'Mockinterview '+kind+' unavailable', 'name': 'projects/12345/alertPolicies/'+kind.lower(), 'conditions': [{'name': 'projects/12345/alertPolicies/'+kind.lower()+'/conditions/old'}]} for kind in ['Web', 'API']]}
            if method == 'PATCH':
                self.assertNotIn('/other', url)
                return body
            self.fail('Unexpected operation: '+method+' '+url)
        calls = self.run_helper('monitor.py', env, response)
        changes = [body for method, _, body in calls if method == 'PATCH']
        self.assertEqual(len(changes), 4)
        api = next(row for row in changes if row['displayName'] == 'Mockinterview API')
        self.assertEqual(api['httpCheck']['path'], '/readyz')
        self.assertEqual(api['monitoredResource']['labels']['host'], 'api.example.com')
        for row in changes:
            if 'notificationChannels' in row:
                self.assertEqual(row['notificationChannels'], [env['MONITORING_NOTIFICATION_CHANNEL']])

    def test_staging_cannot_use_production_database(self):
        env = {'PATH': os.environ['PATH'], 'PROJECT_ID': 'test-project', 'SERVICE': 'mockinterview-api',
               'TARGET_SERVICE': 'mockinterview-api-staging', 'DB_NAME': 'mockinterview', 'DB_USER': 'mockinterview'}
        command = ['bash', '-c', 'source '+shlex.quote(str(ROOT / 'deploy/common.sh'))+'; configure_target']
        self.assertNotEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)
        env.update(DB_NAME='mockinterview_staging', DB_USER='mockinterview_staging')
        self.assertEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)

if __name__ == '__main__':
    unittest.main()
