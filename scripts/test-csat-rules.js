#!/usr/bin/env node
/**
 * Verify the CSAT portal business rules against a live instance:
 * active-company filtering, Account Primary Contact resolution, portal-account
 * checks, the 90-day cooldown, and the immediate-only survey restriction.
 *
 * Installs a temporary Scripted REST helper and removes it afterwards.
 */
const { base, headers, snGet, snPost, snDelete, announceTarget } = require('./lib/sn-client');

const PROBE_SCRIPT = `(function process(request, response) {
  function param(name) {
    var v = request.queryParams[name];
    if (v === null || v === undefined) return '';
    return String(Array.isArray(v) ? v[0] : v);
  }

  var svc = new CSATSurveyService();
  var out = {};

  var action = param('probe');

  if (action === 'primary') {
    out.result = svc.getPrimaryContact(param('company_id'));
  } else if (action === 'cooldown') {
    out.result = svc.getCooldown(param('user_id'));
  } else if (action === 'users') {
    out.result = svc.getUsersByCompany(param('company_id'));
  } else if (action === 'companies') {
    var term = param('term');
    var list = svc.getCompanies(term, 500);
    var inactive = 0;
    for (var i = 0; i < list.length; i++) {
      var gr = new GlideRecord('core_company');
      if (gr.get(list[i].sys_id) && gr.getValue('u_active') != '1' && gr.getValue('u_active') !== 'true') inactive++;
    }
    out.result = { returned: list.length, inactive_in_result: inactive, sample: list.slice(0, 3) };
  } else if (action === 'templates') {
    out.result = svc.getSurveyTemplates();
  } else if (action === 'immediate') {
    out.result = {
      closed_case: svc.isImmediateOnly('Closed Case Survey'),
      complex: svc.isImmediateOnly('Complex Resolution Survey'),
      generic: svc.isImmediateOnly('Generic Quarterly Survey')
    };
  } else if (action === 'cooldown_days') {
    out.result = { days: svc.COOLDOWN_DAYS };
  }

  return out;
})(request, response);`;

async function installProbe(apiSysId) {
  const existing = await snGet(
    'sys_ws_operation',
    `sysparm_query=web_service_definition=${apiSysId}^name=test_probe&sysparm_fields=sys_id`
  );
  if (existing.length) return existing[0].sys_id;
  const created = await snPost('sys_ws_operation', {
    web_service_definition: apiSysId,
    name: 'test_probe',
    http_method: 'GET',
    relative_path: '/test_probe',
    active: true,
    operation_script: PROBE_SCRIPT,
    requires_authentication: true,
  });
  return created.sys_id;
}

async function probe(apiBase, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}${apiBase}/test_probe?${qs}`, { headers });
  const body = await res.json();
  return body.result ? body.result.result : null;
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  announceTarget('Verify CSAT portal rules');

  const api = (await snGet('sys_ws_definition', 'sysparm_query=name=CSAT Survey API&sysparm_fields=sys_id,base_uri'))[0];
  const probeSysId = await installProbe(api.sys_id);

  try {
    console.log('Rule 1 — only active companies, searchable');
    const companies = await probe(api.base_uri, { probe: 'companies' });
    check('company list excludes inactive', companies.inactive_in_result === 0, `${companies.returned} returned, ${companies.inactive_in_result} inactive`);
    const searched = await probe(api.base_uri, { probe: 'companies', term: 'Bank' });
    const allMatch = searched.sample.every((c) => /bank/i.test(c.name));
    check('search term filters results', searched.returned > 0 && allMatch, `"Bank" -> ${searched.returned} matches`);

    console.log('\nRule 4 — immediate-only surveys');
    const imm = await probe(api.base_uri, { probe: 'immediate' });
    check('Closed Case Survey is immediate-only', imm.closed_case === true);
    check('Complex Resolution Survey is immediate-only', imm.complex === true);
    check('Generic Quarterly Survey allows scheduling', imm.generic === false);

    console.log('\nRule 5 — 90-day cooldown');
    const cd = await probe(api.base_uri, { probe: 'cooldown_days' });
    check('cooldown window is 90 days', cd.days === 90, `${cd.days} days`);

    console.log('\nRules 2 & 3 — Account Primary Contact');
    const withContact = await snGet(
      'customer_account',
      'sysparm_query=primary_contactISNOTEMPTY^u_active=true&sysparm_fields=sys_id,name,primary_contact&sysparm_limit=3'
    );
    if (!withContact.length) {
      check('an account has a Primary Contact', false, 'no active account has primary_contact set');
    } else {
      for (const company of withContact) {
        const primary = await probe(api.base_uri, { probe: 'primary', company_id: company.sys_id });
        const resolved = !!(primary && primary.user);
        check(
          `resolves contact for ${company.name}`,
          resolved,
          resolved
            ? `${primary.user.name} <${primary.user.email}>, eligible=${primary.eligible}${primary.reason ? ` (${primary.reason})` : ''}`
            : primary && primary.reason
        );
      }
    }

    const noContact = (await snGet(
      'customer_account',
      'sysparm_query=u_active=true^primary_contactISEMPTY&sysparm_fields=sys_id,name&sysparm_limit=1'
    ))[0];
    if (noContact) {
      const primary = await probe(api.base_uri, { probe: 'primary', company_id: noContact.sys_id });
      check('account without a Primary Contact reports a reason', !primary.eligible && !!primary.reason, primary.reason);
    }

    const offered = await probe(api.base_uri, { probe: 'templates' });
    check(
      'portal offers only the approved surveys',
      offered.every((t) => ['Complex Resolution Survey', 'Generic Quarterly Survey'].indexOf(t.name) !== -1),
      offered.map((t) => t.name).join(', ') || 'none'
    );

    console.log('\nUser eligibility metadata');
    const anyCompany = (await snGet(
      'sys_user',
      'sysparm_query=active=true^companyISNOTEMPTY&sysparm_fields=company&sysparm_limit=1'
    ))[0];
    if (anyCompany) {
      const users = await probe(api.base_uri, { probe: 'users', company_id: anyCompany.company.value });
      const shaped = users.length === 0 || users.every((u) => 'eligible' in u && 'reason' in u);
      check('users carry eligibility flags', shaped, `${users.length} user(s)`);
    }

    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed) process.exitCode = 1;
  } finally {
    await snDelete('sys_ws_operation', probeSysId);
    console.log('Removed temporary probe endpoint.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
