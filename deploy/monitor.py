"""Reconcile this app's uptime checks and optional verified alert routing.

Run after deploying an API with /ready. Uses PROJECT_ID, PUBLIC_URL,
WEB_API_BASE and optional MONITORING_NOTIFICATION_CHANNEL. No channel is chosen
implicitly and another application's monitoring resources are never changed.
"""
import json
import os
import ssl
import subprocess
import urllib.parse
import urllib.request

project = os.environ['PROJECT_ID']
project_number = subprocess.check_output(['gcloud', 'projects', 'describe', project, '--format=value(projectNumber)'], text=True).strip()
channel = os.environ.get('MONITORING_NOTIFICATION_CHANNEL', '')
ca = '/opt/homebrew/etc/ca-certificates/cert.pem'
ctx = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
base = f'https://monitoring.googleapis.com/v3/projects/{project}'

def call(method, path, data=None):
    req = urllib.request.Request(base+path, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json', 'x-goog-user-project': project})
    with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
        return json.load(response)

def listing(path, key):
    rows, page = [], ''
    while True:
        suffix = '?'+urllib.parse.urlencode({'pageToken': page}) if page else ''
        response = call('GET', path+suffix)
        rows.extend(response.get(key, []))
        page = response.get('nextPageToken', '')
        if not page:
            return rows

def resource_path(name):
    for project_name in {project, project_number}:
        prefix = f'projects/{project_name}/'
        if name.startswith(prefix):
            return '/'+name[len(prefix):]
    raise ValueError('Resource must belong to the selected project')

if channel:
    if not resource_path(channel).startswith('/notificationChannels/'):
        raise ValueError('Notification channel must belong to the selected project')
    ch = call('GET', resource_path(channel))
    if not ch.get('enabled', True) or ch.get('verificationStatus') == 'UNVERIFIED':
        raise ValueError('Notification channel is disabled or unverified')

existing = listing('/uptimeCheckConfigs', 'uptimeCheckConfigs')
checks = []
for suffix, url, path in [('Web', os.environ['PUBLIC_URL'], '/'), ('API', os.environ['WEB_API_BASE'], '/ready')]:
    origin = urllib.parse.urlparse(url)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.query or origin.fragment or origin.path not in ('', '/'):
        raise ValueError('A valid HTTPS application origin is required')
    name = 'Mockinterview '+suffix
    desired = {'displayName': name,
        'monitoredResource': {'type': 'uptime_url', 'labels': {'project_id': project, 'host': origin.hostname}},
        'httpCheck': {'requestMethod': 'GET', 'useSsl': True, 'validateSsl': True, 'path': path, 'port': origin.port or 443},
        'period': '300s', 'timeout': '10s', 'selectedRegions': ['USA']}
    matches = [c for c in existing if c['displayName'] == name]
    if len(matches) > 1:
        raise ValueError('Duplicate app uptime check names; resolve them before changing monitoring')
    if matches:
        desired['name'] = matches[0]['name']
        mask = 'displayName,monitoredResource,httpCheck,period,timeout,selectedRegions'
        check = call('PATCH', resource_path(desired['name'])+'?'+urllib.parse.urlencode({'updateMask': mask}), desired)
    else:
        check = call('POST', '/uptimeCheckConfigs', desired)
    checks.append(check)
    print('Uptime check configured:', check['name'])

if not channel:
    print('Alert routing unchanged: set MONITORING_NOTIFICATION_CHANNEL to an existing verified channel to configure it.')
else:
    policies = listing('/alertPolicies', 'alertPolicies')
    for check in checks:
        display = check['displayName']+' unavailable'
        matches = [p for p in policies if p['displayName'] == display]
        if len(matches) > 1:
            raise ValueError('Duplicate app alert policy names; resolve them before changing monitoring')
        cid = check['name'].rsplit('/', 1)[1]
        desired = {'displayName': display, 'combiner': 'OR', 'enabled': True, 'notificationChannels': [channel],
            'documentation': {'mimeType': 'text/markdown', 'content': 'Check the affected mockinterview service, release, readiness and Cloud Run logs. Use docs/RELEASE-RUNBOOK.md for rollback. Never restore the shared SQL instance for an app-only issue.'},
            'conditions': [{'displayName': 'Uptime check failing', 'conditionThreshold': {
                'filter': f'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND metric.label.check_id="{cid}"',
                'comparison': 'COMPARISON_LT', 'thresholdValue': 1, 'duration': '300s',
                'aggregations': [{'alignmentPeriod': '300s', 'perSeriesAligner': 'ALIGN_FRACTION_TRUE'}], 'trigger': {'count': 1}}}]}
        if matches:
            desired['name'] = matches[0]['name']
            old_conditions = matches[0].get('conditions', [])
            if len(old_conditions) == 1 and old_conditions[0].get('name'):
                desired['conditions'][0]['name'] = old_conditions[0]['name']
            mask = 'displayName,combiner,enabled,notificationChannels,documentation,conditions'
            call('PATCH', resource_path(desired['name'])+'?'+urllib.parse.urlencode({'updateMask': mask}), desired)
        else:
            call('POST', '/alertPolicies', desired)
        print('Alert policy configured:', display)
