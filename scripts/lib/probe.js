/**
 * Runs server-side script against an instance over REST.
 *
 * Several checks need to call CSATSurveyService or CSATSurveyReport directly,
 * which the Table API cannot do. They used to borrow the product's own
 * Scripted REST API; that API was a leftover from the original UI Page build
 * and has been removed, so the tooling now owns a clearly-labelled endpoint of
 * its own.
 *
 * The API definition is created once and left in place, which keeps update
 * sets free of create/delete churn. Only the operation is per-run, and it is
 * always removed. Neither belongs to the product, so both are excluded from
 * the consolidated update set.
 */
const { base, headers, snGet, snPost, snDelete, sleep } = require('./sn-client');

const PROBE_API_NAME = 'CSAT Test Probe';
const PROBE_SERVICE_ID = 'csat_test_probe';

async function ensureProbeApi() {
  const existing = await snGet(
    'sys_ws_definition',
    `sysparm_query=${encodeURIComponent(`name=${PROBE_API_NAME}`)}&sysparm_fields=sys_id,base_uri`
  );
  if (existing.length && existing[0].base_uri) return existing[0];

  const created = await snPost('sys_ws_definition', {
    name: PROBE_API_NAME,
    service_id: PROBE_SERVICE_ID,
    active: true,
    short_description:
      'Development and test tooling only. Hosts short-lived endpoints used by the CSAT check scripts. Not part of the CSAT solution and deliberately excluded from its update set.',
    consumes: 'application/json',
    produces: 'application/json',
  });

  const withUri = await snGet(
    'sys_ws_definition',
    `sysparm_query=sys_id=${created.sys_id}&sysparm_fields=sys_id,base_uri`
  );
  return withUri[0];
}

/**
 * Installs `script` as a temporary resource, hands the caller a function to
 * invoke it, and removes the resource afterwards.
 *
 * The callback receives call(options) where options may set { params, body }.
 * A body switches the request to POST. The resolved value is whatever the
 * script returned under `result`.
 */
async function withProbe(name, script, run, method) {
  const api = await ensureProbeApi();

  const existing = await snGet(
    'sys_ws_operation',
    `sysparm_query=web_service_definition=${api.sys_id}^name=${name}&sysparm_fields=sys_id`
  );
  for (const stale of existing) await snDelete('sys_ws_operation', stale.sys_id);

  const operation = await snPost('sys_ws_operation', {
    web_service_definition: api.sys_id,
    name,
    http_method: method || 'GET',
    relative_path: `/${name}`,
    active: true,
    operation_script: script,
    requires_authentication: true,
  });

  // The platform needs a moment before a newly created resource resolves.
  await sleep(1500);

  const call = async (options = {}) => {
    const query = options.params ? `?${new URLSearchParams(options.params).toString()}` : '';
    const init = options.body
      ? {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }
      : { headers };

    const res = await fetch(`${base}${api.base_uri}/${name}${query}`, init);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`probe "${name}" returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (parsed.error) throw new Error(`probe "${name}" failed: ${JSON.stringify(parsed.error).slice(0, 300)}`);
    return parsed.result && parsed.result.result !== undefined ? parsed.result.result : parsed.result;
  };

  try {
    return await run(call);
  } finally {
    await snDelete('sys_ws_operation', operation.sys_id);
  }
}

module.exports = { withProbe, PROBE_API_NAME };
