#!/usr/bin/env python3
"""Explicitly billable synthetic Gemini smoke in a disposable local PG schema.

Reads GEMINI_API_KEY from the environment, or an explicitly selected Secret
Manager project/secret into memory. Never run in CI. Requires Go, Node22, psql,
and a local mockinterview_launch_test database owned by the current local role.
"""
import argparse
import base64
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', default='')
parser.add_argument('--secret', default='mockinterview-gemini-key')
parser.add_argument('--port', type=int, default=8083)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
schema = 'providercheck_'+uuid.uuid4().hex
admin = 'postgres:///mockinterview_launch_test?host=/tmp'
server = None
key = ''
logs = []
exit_code = 1
with tempfile.TemporaryDirectory(prefix='mockinterview-provider-') as temporary:
    binary = str(Path(temporary)/'api')
    subprocess.run(['go', 'build', '-o', binary, './cmd/mockinterview'], cwd=root/'api', check=True)
    subprocess.run(['psql', admin, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'CREATE SCHEMA '+schema], check=True, stdout=subprocess.DEVNULL)
    try:
        key = os.environ.get('GEMINI_API_KEY', '')
        if not key:
            if not args.project:
                raise RuntimeError('Provide GEMINI_API_KEY or explicitly select --project for Secret Manager.')
            key = subprocess.check_output(['gcloud', 'secrets', 'versions', 'access', 'latest', '--secret='+args.secret, '--project='+args.project], text=True).strip()
        env = dict(os.environ)
        env.update(APP_ENV='development', LOCAL_UNLIMITED='true', PORT=str(args.port), DATABASE_URL=admin+'&search_path='+schema,
                   DB_MAX_CONNS='5', JWT_SECRET=secrets.token_hex(32), SESSION_ENCRYPTION_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),
                   LLM_PROVIDER='gemini', GEMINI_API_KEY=key, LLM_MODEL='gemini-2.5-flash', GEMINI_MODEL_REASON='gemini-2.5-flash',
                   GEMINI_MODEL_LIVE='gemini-2.5-flash-native-audio-preview-12-2025', USE_STUB_LLM='false',
                   PUBLIC_URL='http://localhost:3000', CORS_ALLOW='http://localhost:3000', MODE='api',
                   CORPUS_DIR=str(root/'api/data/corpus'), PACKS_DIR=str(root/'api/data/packs'), RELEASE_SHA='synthetic-provider-check')
        for name in ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'META_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_BASE_URL', 'RESEND_API_KEY', 'SMTP_ADDRESS', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'MAIL_FROM']:
            env[name] = ''
        server = subprocess.Popen([binary], cwd=temporary, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        def drain():
            for line in server.stdout:
                logs.append(line.replace(key, '[REDACTED]'))
        threading.Thread(target=drain, daemon=True).start()
        origin = 'http://localhost:'+str(args.port)
        ready = False
        for _ in range(100):
            if server.poll() is not None:
                break
            try:
                with urllib.request.urlopen(origin+'/readyz', timeout=1) as response:
                    ready = response.status == 200
                if ready:
                    break
            except Exception:
                pass
            time.sleep(.1)
        if not ready:
            raise RuntimeError('Isolated API did not become ready')
        print('Isolated real-provider check started; no microphone or camera input.', flush=True)
        client_env = {'PATH': os.environ['PATH'], 'SMOKE_API_BASE': origin}
        if os.environ.get('SMOKE_ONLY'):
            client_env['SMOKE_ONLY'] = os.environ['SMOKE_ONLY']
        result = subprocess.run(['node', str(root/'scripts/smoke-gemini.mjs')], cwd=root, env=client_env, capture_output=True, text=True, timeout=245)
        print(result.stdout.replace(key, '[REDACTED]'))
        print(result.stderr.replace(key, '[REDACTED]'))
        exit_code = result.returncode
        if exit_code:
            print('Sanitized API diagnostics:\n'+''.join(logs[-18:]))
    except subprocess.TimeoutExpired:
        print('Provider check exceeded the bounded time budget; stopped without recording media.')
    except Exception as error:
        print('Provider check failed:', str(error).replace(key, '[REDACTED]') if key else str(error))
        print(''.join(logs[-12:]))
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        subprocess.run(['psql', admin, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA '+schema+' CASCADE'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        print('Synthetic schema and local API removed.', flush=True)
raise SystemExit(exit_code)
