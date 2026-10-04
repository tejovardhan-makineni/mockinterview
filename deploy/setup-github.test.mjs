import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve(import.meta.dirname, "setup-github.sh");
const fakeCLI = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), tool = path.basename(process.argv[1]);
const file = process.env.BOOTSTRAP_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const has = (word) => args.includes(word);
const value = (flag) => args.find((a) => a.startsWith(flag+'='))?.slice(flag.length+1) || args[args.indexOf(flag)+1];
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const out = (object) => console.log(JSON.stringify(object));
const mutation = () => { state.mutations.push([tool,...args]); save(); };
const sa = 'mockinterview-deploy@storybytes-495010.iam.gserviceaccount.com';
const runtime = 'mockinterview-runtime@storybytes-495010.iam.gserviceaccount.com';
const pool = 'projects/661893776515/locations/global/workloadIdentityPools/mockinterview-github';
if (tool === 'gh') {
  if (args[0] === 'variable') { mutation(); process.exit(0); }
  if (has('--method')) {
    if (value('--method') === 'PUT') state.environment = {deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}};
    if (value('--method') === 'POST') state.branches = {total_count:1,branch_policies:[{name:'main',type:'branch'}]};
    mutation(); out({}); process.exit(0);
  }
  if (args[1].includes('deployment-branch-policies')) out(state.branches || {total_count:0,branch_policies:[]});
  else if (args[1].endsWith('/environments/production')) {
    if (!state.environment) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
    out(state.environment);
  } else out({id:state.wrongRepo ? 1 : 1363533004,owner:{id:35104991},full_name:'tejovardhan-makineni/mockinterview',default_branch:'main'});
} else if (args[0] === 'projects' && args[1] === 'describe') out({projectNumber:'661893776515',lifecycleState:'ACTIVE'});
else if (args[0] === 'services') out(['iam','iamcredentials','sts','run','artifactregistry'].map((api) => ({config:{name:api+'.googleapis.com'}})));
else if (args[0] === 'projects' && args[1] === 'get-iam-policy') out({bindings:state.broadRole ? [{role:'roles/editor',members:['serviceAccount:'+sa]}] : []});
else if (has('keys')) out([]);
else if (has('get-iam-policy')) out({bindings:[]});
else if (args[0] === 'run' && has('describe')) out({spec:{template:{spec:{serviceAccountName:runtime}}}});
else if (has('service-accounts') && has('describe')) out({email:runtime});
else if (has('service-accounts') && has('list')) out(state.account ? [state.account] : []);
else if (has('repositories') && has('list')) out(state.artifact ? [state.artifact] : []);
else if (has('providers') && has('list')) out(state.provider ? [state.provider] : []);
else if (has('workload-identity-pools') && has('list')) out(state.pool ? [state.pool] : []);
else if (has('add-iam-policy-binding')) mutation();
else if (has('create') || has('create-oidc')) {
  if (has('service-accounts')) state.account = {email:sa,description:value('--description')};
  else if (has('repositories')) state.artifact = {name:'projects/storybytes-495010/locations/us-west1/repositories/mockinterview',format:'DOCKER',description:value('--description')};
  else if (has('providers')) state.provider = {name:pool+'/providers/github-deploy',description:value('--description'),state:'ACTIVE',attributeCondition:value('--attribute-condition'),attributeMapping:Object.fromEntries(value('--attribute-mapping').split(',').map((part) => part.split('='))),oidc:{issuerUri:value('--issuer-uri')}};
  else if (has('workload-identity-pools')) state.pool = {name:pool,description:value('--description'),state:'ACTIVE'};
  mutation();
} else { console.error('Unexpected fake command', tool, args); process.exit(2); }
`;

function fixture(seed = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mockinterview-bootstrap-test-"));
  const statePath = join(directory, "state.json");
  writeFileSync(statePath, JSON.stringify({ mutations: [], ...seed }));
  for (const tool of ["gcloud", "gh"]) {
    const command = join(directory, tool);
    writeFileSync(command, fakeCLI);
    chmodSync(command, 0o700);
  }
  return {
    run: (...args) => spawnSync("bash", [script, ...args], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, BOOTSTRAP_TEST_STATE: statePath },
    }),
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("default plan is non-mutating and pins repository, owner, workflow, ref, events and environment", () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    for (const expected of ["1363533004", "35104991", "refs/heads/main", "deploy.yml@refs/heads/main", "assertion.environment == 'production'", "workflow_run", "workflow_dispatch", "Hosting Admin on all project sites: false"]) assert.ok(result.stdout.includes(expected));
    assert.deepEqual(f.state().mutations, []);
  } finally { f.close(); }
});

test("apply is API-only by default, binds resources narrowly, and safely reruns", () => {
  const f = fixture();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.run("--apply");
      assert.equal(result.status, 0, result.stderr);
    }
    const mutations = f.state().mutations;
    assert.equal(mutations.filter((args) => args.includes("create-oidc")).length, 1);
    assert.equal(mutations.filter((args) => args.includes("create") && args.includes("service-accounts")).length, 1);
    assert.ok(mutations.some((args) => args.includes("--role=roles/run.developer") && args[1] === "run" && args[4] === "mockinterview-api"));
    assert.ok(mutations.some((args) => args.includes("--role=roles/iam.serviceAccountUser") && args.includes("mockinterview-runtime@storybytes-495010.iam.gserviceaccount.com")));
    assert.ok(!mutations.some((args) => args[1] === "projects"));
    assert.ok(!JSON.stringify(mutations).includes("roles/serviceusage.apiKeysViewer"));
    assert.equal(mutations.filter((args) => args[1] === "variable").length, 16);
  } finally { f.close(); }
});

test("Hosting write access requires its explicit project-wide acknowledgment", () => {
  const f = fixture();
  try {
    const result = f.run("--apply", "--acknowledge-project-wide-hosting");
    assert.equal(result.status, 0, result.stderr);
    const bindings = f.state().mutations.filter((args) => args[1] === "projects");
    assert.equal(bindings.length, 1);
    assert.ok(bindings[0].includes("--role=roles/firebasehosting.admin"));
  } finally { f.close(); }
});

for (const [name, seed] of Object.entries({
  "different immutable repository": { wrongRepo: true },
  "unowned deploy identity": { account: {email:"mockinterview-deploy@storybytes-495010.iam.gserviceaccount.com",description:"Someone else's identity"} },
  "broader project permissions": { broadRole: true },
  "unrestricted environment": { environment: {deployment_branch_policy:null} },
  "unexpected provider in dedicated pool": {pool:{name:"projects/661893776515/locations/global/workloadIdentityPools/mockinterview-github",description:"Managed by mockinterview keyless CI: tejovardhan-makineni/mockinterview (1363533004)",state:"ACTIVE"},provider:{name:"unexpected-provider"}},
})) {
  test(`refuses ${name} before IAM changes`, () => {
    const f = fixture(seed);
    try {
      const result = f.run("--apply");
      assert.notEqual(result.status, 0);
      assert.deepEqual(f.state().mutations, []);
    } finally { f.close(); }
  });
}
