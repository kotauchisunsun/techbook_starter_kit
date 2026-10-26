// Use the ID returned by this attempt's upload step, never a name-based search:
// multiple runs (and reruns) may upload artifacts with the same name.
const jstDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});

function formatExpiryDate(value) {
  // API timestamps carry an explicit timezone; reject ambiguous date-only inputs.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = Object.fromEntries(jstDate.formatToParts(timestamp).map(({type, value}) => [type, value]));
  return `${parts.year}/${parts.month}/${parts.day}`;
}

async function artifactDownloadLine({github, core, context, artifactId, artifactUrl, expectedName, label, now = Date.now()}) {
  const id = Number(artifactId);
  const unknown = `- ${label} — 保持期限:不明`;
  if (!Number.isSafeInteger(id) || id <= 0 || !artifactUrl) {
    return `${unknown}（Artifact をアップロードできませんでした）`;
  }
  let artifact;
  try {
    ({data: artifact} = await github.rest.actions.getArtifact({...context.repo, artifact_id: id}));
  } catch (error) {
    if (error.status === 404 || error.status === 410) {
      return `${unknown}（Artifact が見つからないか、削除済みです）`;
    }
    core.warning(`Could not read artifact ${id} metadata (HTTP ${error.status || 'unknown'}).`);
    return `- [${label}](${artifactUrl}) — 保持期限:取得できませんでした`;
  }
  // Do not attach a date from a different artifact or workflow run.
  if (artifact?.id !== id || artifact.name !== expectedName || artifact.workflow_run?.id !== context.runId) {
    core.warning(`Artifact ${id} metadata does not match this upload and workflow run.`);
    return `${unknown}（この実行の Artifact を確認できませんでした）`;
  }
  const expiry = formatExpiryDate(artifact.expires_at);
  const retention = `保持期限:${expiry ? `${expiry}（JST）` : '不明'}`;
  if (artifact.expired || (expiry && Date.parse(artifact.expires_at) <= now)) {
    return `- ${label} — ${retention}（期限切れ）`;
  }
  return `- [${label}](${artifactUrl}) — ${retention}`;
}

function runDetails({context, env = process.env}) {
  const run = `${env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  return `[実行 #${context.runNumber} / attempt ${env.GITHUB_RUN_ATTEMPT}](${run})`;
}

const retentionNote = '保持期間は最大7日間です。PR が閉じられた場合など、期限前に削除されることがあります。';

module.exports = {formatExpiryDate, artifactDownloadLine, runDetails, retentionNote};
