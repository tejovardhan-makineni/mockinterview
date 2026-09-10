"""App-scoped Cloud SQL database/user setup with explicit password rotation."""
import argparse
import json
import os
import re
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--rotate-password', action='store_true')
args = parser.parse_args()
project = os.environ['PROJECT_ID']
connection = os.environ['CLOUDSQL_INSTANCE'].split(':')
if len(connection) != 3 or connection[0] != project:
    raise SystemExit('Cloud SQL instance must belong to the selected project.')
instance = connection[2]
database = os.environ['DB_NAME']
user = os.environ['DB_USER']
password = os.environ.get('DB_PASSWORD', '')
for label, value in [('database', database), ('user', user)]:
    if not re.fullmatch(r'mockinterview(?:[_-][a-z0-9]+)*', value):
        raise SystemExit(f'Refusing non-app {label}: use a mockinterview-prefixed name.')
if os.environ.get('TARGET_SERVICE', '').endswith('-staging'):
    if not database.endswith('staging') or not user.endswith('staging'):
        raise SystemExit('Staging requires an isolated database and user.')
ca = '/opt/homebrew/etc/ca-certificates/cert.pem'
tls = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
base = f'https://sqladmin.googleapis.com/sql/v1beta4/projects/{project}'
q = urllib.parse.quote

def call(method, path, body=None):
    req = urllib.request.Request(base+path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json', 'x-goog-user-project': project})
    try:
        with urllib.request.urlopen(req, context=tls, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Cloud SQL request failed ({error.code}); no error was treated as success.') from None

def finish(operation):
    for _ in range(120):
        if operation.get('status') == 'DONE':
            if operation.get('error'):
                raise SystemExit('Cloud SQL operation failed. Inspect its status in the project console.')
            return
        time.sleep(2)
        operation = call('GET', '/operations/'+q(operation['name'], safe=''))
    raise SystemExit('Cloud SQL operation timed out; inspect its status before retrying.')

prefix = '/instances/'+q(instance, safe='')
users = call('GET', prefix+'/users').get('items', [])
existing = next((entry for entry in users if entry.get('name') == user), None)
owner_role = os.environ.get('DB_OWNER_ROLE', '')
if existing is None and owner_role != database+'_owner':
    raise SystemExit('New users require DB_OWNER_ROLE=<DB_NAME>_owner, precreated and reviewed in PostgreSQL. Refusing Cloud SQL default elevated privileges.')
if existing is None or args.rotate_password:
    if len(password) < 20:
        raise SystemExit('Set a strong DB_PASSWORD of at least 20 characters before creating or rotating the app user.')
    body = {'name': user, 'password': password}
    if existing is None:
        # Cloud SQL grants cloudsqlsuperuser when custom databaseRoles is absent.
        # A missing role must fail at the provider; never retry without it.
        body['databaseRoles'] = [owner_role]
        finish(call('POST', prefix+'/users', body))
        print('Created app database user with the explicit custom owner role. Verify role attributes and grants before deploying.')
    else:
        if existing.get('type', 'BUILT_IN') != 'BUILT_IN':
            raise SystemExit('Refusing password rotation for an IAM database user.')
        suffix = '?'+urllib.parse.urlencode({'name': user, 'host': existing.get('host', '')})
        finish(call('PUT', prefix+'/users'+suffix, body))
        print('Rotated app database password by explicit request. Update its secret version before deployment.')
else:
    print('App database user exists; password unchanged.')
databases = call('GET', prefix+'/databases').get('items', [])
if any(entry.get('name') == database for entry in databases):
    print('App database exists; unchanged.')
else:
    finish(call('POST', prefix+'/databases', {'name': database}))
    print('Created app database. Migrations apply when its API starts.')
