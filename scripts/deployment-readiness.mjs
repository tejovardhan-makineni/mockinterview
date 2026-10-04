import { appendFileSync } from "node:fs";

// This is an operator setup switch, separate from the mandatory release checks.
// It must never infer cloud authorization from the presence of repository vars.
const enabled = process.env.PRODUCTION_DEPLOY_ENABLED === "true";
const event = process.env.GITHUB_EVENT_NAME;
if (!["workflow_run", "workflow_dispatch"].includes(event)) {
  throw new Error("Deployment readiness requires a supported workflow event.");
}
appendFileSync(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`);
if (!enabled) {
  const message =
    "Production deployment is inactive until Hosting permissions and deployment settings are configured. " +
    "Follow docs/GITHUB-DEPLOYMENT.md, then set PRODUCTION_DEPLOY_ENABLED=true. " +
    "No build, cloud authentication or deployment was started.\n";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  console.log(message.trim());
  // Routine merges remain valid during setup; explicit releases must report
  // that they did not deploy instead of appearing to have succeeded.
  if (event === "workflow_dispatch") process.exitCode = 1;
}
