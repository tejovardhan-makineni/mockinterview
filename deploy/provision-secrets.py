"""App-only Secret Manager provisioning. Credentials stay in process memory."""
import base64
import json
import os
import re
import secrets
import ssl
import subprocess
import urllib.error
import urllib.parse
import urllib.request

project = os.environ['PROJECT_ID']
prefix = os.environ.get('SECRET_PREFIX', 'mockinterview')
account_id = os.environ.get('RUNTIME_ACCOUNT_ID', 'mockinterview-runtime')
account = f'{account_id}@{project}.iam.gserviceaccount.com'
if not re.fullmatch(r'mockinterview(?:-[a-z0-9]+)*', prefix) or not re.fullmatch(r'mockinterview(?:-[a-z0-9]+)*', account_id):
    raise SystemExit('Refusing secret or runtime identity outside the mockinterview namespace.')
if os.environ.get('TARGET_SERVICE', '').endswith('-staging'):
    if not all(os.environ.get(key, '').endswith('staging') for key in ['SECRET_PREFIX', 'RUNTIME_ACCOUNT_ID', 'DB_NAME', 'DB_USER']):
        raise SystemExit('Staging requires isolated secrets, identity, database and database user.')
# macOS framework Python does not always use the system CA bundle.
ca = '/opt/homebrew/etc/ca-certificates/cert.pem'
tls = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()

def request(method, url, body=None):
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=payload, method=method, headers={
        'Authorization': 'Bearer '+token, 'Content-Type': 'application/json', 'x-goog-user-project': project})
    with urllib.request.urlopen(req, context=tls, timeout=30) as response:
        content = response.read()
        return json.loads(content) if content else {}

def exists(url):
    try:
        request('GET', url)
        return True
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return False
        raise RuntimeError(f'Cannot inspect resource ({err.code})') from None

def put(suffix, value=None, generate=False):
    name = f'{prefix}-{suffix}'
    resource = f'https://secretmanager.googleapis.com/v1/projects/{project}/secrets/{name}'
    present = exists(resource)
    if generate and present and not value:
        pass  # Do not rotate a live encryption key by rerunning provisioning.
    else:
        if not value and generate:
            value = base64.b64encode(secrets.token_bytes(32)).decode()
        if not value:
            print(f'Not configured: {name}')
            return
        if not present:
            request('POST', f'https://secretmanager.googleapis.com/v1/projects/{project}/secrets?secretId={name}', {'replication': {'automatic': {}}})
        request('POST', resource+':addVersion', {'payload': {'data': base64.b64encode(value.encode()).decode()}})
    policy = request('GET', resource+':getIamPolicy?options.requestedPolicyVersion=3')
    bindings = policy.setdefault('bindings', [])
    binding = next((b for b in bindings if b['role'] == 'roles/secretmanager.secretAccessor' and not b.get('condition')), None)
    if binding is None:
        binding = {'role': 'roles/secretmanager.secretAccessor', 'members': []}
        bindings.append(binding)
    member = 'serviceAccount:'+account
    if member not in binding['members']:
        binding['members'].append(member)
        request('POST', resource+':setIamPolicy', {'policy': policy})
    print(f'Ready: {name} (runtime access scoped to this secret)')

sa_url = f'https://iam.googleapis.com/v1/projects/{project}/serviceAccounts/{account}'
if not exists(sa_url):
    request('POST', f'https://iam.googleapis.com/v1/projects/{project}/serviceAccounts', {'accountId': account_id, 'serviceAccount': {'displayName': 'Mockinterview runtime'}})
subprocess.run(['gcloud', 'projects', 'add-iam-policy-binding', project, '--member=serviceAccount:'+account, '--role=roles/cloudsql.client', '--condition=None', '--quiet', '--format=none'], check=True, stdout=subprocess.DEVNULL)

dsn = os.environ.get('DATABASE_URL', '')
if not dsn:
    q = urllib.parse.quote
    dsn = f"postgres://{q(os.environ['DB_USER'],safe='')}:{q(os.environ['DB_PASSWORD'],safe='')}@/{q(os.environ['DB_NAME'],safe='')}?host=/cloudsql/{q(os.environ['CLOUDSQL_INSTANCE'],safe=':')}&sslmode=disable"
parsed = urllib.parse.urlparse(dsn)
query = urllib.parse.parse_qs(parsed.query)
if (parsed.scheme not in ('postgres', 'postgresql') or
    urllib.parse.unquote(parsed.username or '') != os.environ['DB_USER'] or
    urllib.parse.unquote(parsed.path).lstrip('/') != os.environ['DB_NAME'] or
    query.get('host') != ['/cloudsql/'+os.environ['CLOUDSQL_INSTANCE']]):
    raise SystemExit('DATABASE_URL must match the selected app database, user and Cloud SQL instance.')
put('database-url', dsn)
put('jwt-secret', os.environ.get('JWT_SECRET'), generate=True)
put('gemini-key', os.environ.get('GEMINI_API_KEY'))
put('session-key', os.environ.get('SESSION_ENCRYPTION_KEY'), generate=True)
put('mail-key', os.environ.get('RESEND_API_KEY') or os.environ.get('SMTP_PASSWORD'))
provider = os.environ.get('LLM_PROVIDER', 'gemini')
if provider != 'gemini':
    put('reasoning-key', os.environ.get(provider.upper()+'_API_KEY'))
print('Dedicated runtime identity:', account)
