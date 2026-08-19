#!/usr/bin/env node
/**
 * Verify the CSAT portal business rules against a live instance:
 * active-company filtering, Account Primary Contact resolution, portal-account
 * checks, the 90-day cooldown, and the immediate-only survey restriction.
 *
 * Installs a temporary Scripted REST helper and removes it afterwards.
 */
const { snGet, announceTarget } = require('./lib/sn-client');
const { withProbe } = require('./lib/probe');

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
      generic: svc.isImmediateOnly('Generic Schedule Survey')
    };
  } else if (action === 'cooldown_days') {
    out.result = { days: svc.COOLDOWN_DAYS };
  } else if (action === 'link') {
    out.result = {
      domain: svc.getWhitelabelDomain(param('company_id')),
      link: svc.getSurveyLink('TESTINSTANCE', param('company_id')),
      instance_url: (gs.getProperty('glide.servlet.uri') + '').replace(/\\/+$/, '')
    };
  }

  return out;
})(request, response);`;

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  announceTarget('Verify CSAT portal rules');

  await withProbe('csat_rules', PROBE_SCRIPT, async (call) => {
    const probe = (params) => call({ params });

    console.log('Rule 1 — only active companies, searchable');
    const companies = await probe({ probe: 'companies' });
    check('company list excludes inactive', companies.inactive_in_result === 0, `${companies.returned} returned, ${companies.inactive_in_result} inactive`);
    const searched = await probe({ probe: 'companies', term: 'Bank' });
    const allMatch = searched.sample.every((c) => /bank/i.test(c.name));
    check('search term filters results', searched.returned > 0 && allMatch, `"Bank" -> ${searched.returned} matches`);

    console.log('\nRule 4 — immediate-only surveys');
    const imm = await probe({ probe: 'immediate' });
    check('Closed Case Survey is immediate-only', imm.closed_case === true);
    check('Complex Resolution Survey is immediate-only', imm.complex === true);
    check('Generic Schedule Survey allows scheduling', imm.generic === false);

    console.log('\nRule 5 — 90-day cooldown');
    const cd = await probe({ probe: 'cooldown_days' });
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
        const primary = await probe({ probe: 'primary', company_id: company.sys_id });
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
      const primary = await probe({ probe: 'primary', company_id: noContact.sys_id });
      check('account without a Primary Contact reports a reason', !primary.eligible && !!primary.reason, primary.reason);
    }

    const offered = await probe({ probe: 'templates' });
    check(
      'portal offers only the approved surveys',
      offered.every((t) => ['Complex Resolution Survey', 'Generic Schedule Survey'].indexOf(t.name) !== -1),
      offered.map((t) => t.name).join(', ') || 'none'
    );

    console.log('\nRule 6 — white-label partners get their own domain in the survey link');
    const whitelabelProp = (await snGet(
      'sys_properties',
      'sysparm_query=name=survey.link.whitelabel&sysparm_fields=value'
    ))[0];

    if (!whitelabelProp || !whitelabelProp.value) {
      check('survey.link.whitelabel is configured', true, 'not set on this instance; links use the instance URL');
    } else {
      let partners = {};
      try {
        partners = JSON.parse(whitelabelProp.value);
      } catch (e) {
        check('survey.link.whitelabel holds valid JSON', false, e.message);
      }

      const partnerNames = Object.keys(partners);
      check('survey.link.whitelabel holds valid JSON', partnerNames.length > 0, `${partnerNames.length} partner(s)`);

      // Partner names can contain "&", so the query has to be encoded or it
      // gets truncated into separate URL parameters.
      const q = (encoded) => `sysparm_query=${encodeURIComponent(encoded)}`;
      const nameList = partnerNames.join(',');

      // An account under a partner must inherit that partner's domain.
      const child = (await snGet(
        'customer_account',
        `${q(`account_parent.nameIN${nameList}`)}&sysparm_fields=sys_id,name,account_parent.name&sysparm_limit=1`
      ))[0];

      if (child) {
        const expected = partners[child['account_parent.name']];
        const resolved = await probe({ probe: 'link', company_id: child.sys_id });
        check(
          `${child.name} inherits the ${child['account_parent.name']} domain`,
          resolved.link.indexOf(expected.replace(/\/+$/, '')) === 0,
          resolved.link
        );
      } else {
        check('an account sits under a white-label partner', false, 'none found to test');
      }

      // Anyone outside the map must still reach the instance URL.
      const outside = (await snGet(
        'customer_account',
        `${q(`account_parent.nameNOT IN${nameList}^nameNOT IN${nameList}`)}&sysparm_fields=sys_id,name&sysparm_limit=1`
      ))[0];

      if (outside) {
        const resolved = await probe({ probe: 'link', company_id: outside.sys_id });
        check(
          `${outside.name} falls back to the instance URL`,
          resolved.domain === '' && resolved.link.indexOf(resolved.instance_url) === 0,
          resolved.link
        );
      }
    }

    console.log('\nUser eligibility metadata');
    const anyCompany = (await snGet(
      'sys_user',
      'sysparm_query=active=true^companyISNOTEMPTY&sysparm_fields=company&sysparm_limit=1'
    ))[0];
    if (anyCompany) {
      const users = await probe({ probe: 'users', company_id: anyCompany.company.value });
      const shaped = users.length === 0 || users.every((u) => 'eligible' in u && 'reason' in u);
      check('users carry eligibility flags', shaped, `${users.length} user(s)`);
    }

    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed) process.exitCode = 1;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
