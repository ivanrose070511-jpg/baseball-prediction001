const GITHUB_WORKFLOW_URL =
  "https://api.github.com/repos/ivanrose070511-jpg/baseball-prediction001/actions/workflows/update-and-deploy.yml/dispatches";

async function dispatchBackupUpdate(env) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw new Error("GITHUB_ACTIONS_TOKEN is not configured");
  }

  const response = await fetch(GITHUB_WORKFLOW_URL, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "asian-baseball-cloudflare-scheduler",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { backup: "true" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub dispatch failed (${response.status}): ${detail}`);
  }
}

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchBackupUpdate(env));
  },
};
