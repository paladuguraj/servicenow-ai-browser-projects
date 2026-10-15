#!/usr/bin/env node
/**
 * Validate that a target instance can host the CSAT Survey Portal before
 * deploying. Reports blockers (deployment will fail or produce no surveys)
 * separately from warnings (deploys fine, but needs data or configuration).
 */
const { base, snGet } = require('./lib/sn-client');

const results = [];

function record(level, area, detail) {
  results.push({ level, area, detail });
}

async function safe(area, fn) {
  try {
    await fn();
  } catch (e) {
    record('BLOCKER', area, `Check failed: ${e.message}`);
  }
}

async function checkAuthAndRoles() {
  await safe('Access', async () => {
    const me = await snGet('sys_user', 'sysparm_query=user_name=javascript:gs.getUserName()&sysparm_fields=user_name,name');
    record('OK', 'Access', `Authenticated as ${me[0] ? me[0].user_name : 'unknown'}`);
  });
}

async function checkServicePortal() {
  await safe('Service Portal', async () => {
    const portals = await snGet('sp_portal', 'sysparm_query=url_suffix=sp&sysparm_fields=sys_id,theme,login_page');
    if (!portals.length) {
      const any = await snGet('sp_portal', 'sysparm_limit=1&sysparm_fields=sys_id');
      if (!any.length) {
        record('BLOCKER', 'Service Portal', 'No sp_portal records found; Service Portal plugin appears inactive');
        return;
      }
      record('WARNING', 'Service Portal', 'Stock "/sp" portal missing; theme will fall back to first available');
      return;
    }
    const theme = portals[0].theme ? portals[0].theme.value : '';
    record(theme ? 'OK' : 'WARNING', 'Service Portal', theme ? 'Stock portal and theme available to inherit' : 'Stock portal has no theme set');
  });

  await safe('Service Portal', async () => {
    const conflict = await snGet('sp_portal', 'sysparm_query=url_suffix=csat&sysparm_fields=sys_id,title');
    if (conflict.length)
      record('WARNING', 'Service Portal', `A portal already uses /csat ("${conflict[0].title}") and will be updated in place`);
  });

  await safe('Service Portal', async () => {
    const page = await snGet('sp_page', 'sysparm_query=id=csat_home&sysparm_fields=sys_id');
    if (page.length)
      record('WARNING', 'Service Portal', 'Page id "csat_home" already exists and will be reused');
    const listPage = await snGet('sp_page', 'sysparm_query=id=list&sysparm_fields=sys_id');
    if (!listPage.length)
      record('WARNING', 'Service Portal', 'Stock "list" page missing; the Requests/Executions menu links will not resolve');
  });
}

async function checkReporting() {
  // The report's Excel export uses the platform list exporter, which is always
  // present, but the PDF export needs the PDF generation plugin. Without it the
  // report still runs and exports Excel/CSV, so this is only a warning.
  await safe('Reporting', async () => {
    const plugin = await snGet(
      'sys_plugins',
      'sysparm_query=nameLIKEPDF Generation Utilities&sysparm_fields=name,active'
    );
    const active = plugin.some((p) => p.active === 'true' || p.active === true);
    if (active) {
      record('OK', 'Reporting', 'PDF Generation Utilities active; report PDF export available');
      return;
    }
    record(
      'WARNING',
      'Reporting',
      'PDF Generation Utilities inactive; the report PDF export will fail (Excel and CSV still work)'
    );
  });
}

async function checkSurveyPlatform() {
  await safe('Surveys', async () => {
    const templates = await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey&sysparm_fields=sys_id,name,notify_user'
    );
    if (!templates.length) {
      record('BLOCKER', 'Surveys', 'No active survey definitions (asmt_metric_type with evaluation_method=survey)');
      return;
    }

    let withQuestions = 0;
    const usable = [];
    for (const t of templates) {
      const cats = await snGet('asmt_metric_category', `sysparm_query=metric_type=${t.sys_id}&sysparm_fields=sys_id`);
      let count = 0;
      for (const c of cats) {
        const qs = await snGet('asmt_metric', `sysparm_query=category=${c.sys_id}^active=true&sysparm_fields=sys_id`);
        count += qs.length;
      }
      if (count > 0) {
        withQuestions++;
        usable.push(`${t.name} (${count}q)`);
      }
    }

    if (!withQuestions) {
      record('BLOCKER', 'Surveys', `${templates.length} survey definitions exist but none have questions; every send returns "noquestions"`);
      return;
    }
    record('OK', 'Surveys', `${withQuestions}/${templates.length} definitions have questions, e.g. ${usable.slice(0, 3).join(', ')}`);
  });

  await safe('Surveys', async () => {
    // An unpublished survey returns 'not_available' instead of creating an
    // instance, so it can never be sent from the portal.
    const templates = await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey&sysparm_fields=name,publish_state'
    );
    const drafts = templates.filter((t) => t.publish_state !== 'published');
    const published = templates.length - drafts.length;

    if (!templates.length) return;
    if (!published) {
      record('BLOCKER', 'Surveys', `All ${templates.length} survey definitions are in Draft; none can be sent until published`);
      return;
    }
    if (drafts.length) {
      record('WARNING', 'Surveys', `${drafts.length} survey(s) in Draft and unsendable: ${drafts.map((d) => d.name).join(', ')}`);
      return;
    }
    record('OK', 'Surveys', `All ${published} survey definition(s) are published`);
  });

  await safe('Surveys', async () => {
    const brs = await snGet(
      'sys_script',
      'sysparm_query=collection=asmt_assessment_instance^nameSTARTSWITHDispatch Survey^active=true&sysparm_fields=name'
    );
    record(
      brs.length ? 'OK' : 'WARNING',
      'Surveys',
      brs.length
        ? 'Platform survey dispatch rules present (drives invitation email)'
        : 'Platform "Dispatch Survey" rules missing; invitations rely on the fallback event'
    );
  });

  await safe('Surveys', async () => {
    // Instances rename or replace the stock invitation, so match on the event
    // rather than a specific record name.
    const invites = await snGet(
      'sysevent_email_action',
      'sysparm_query=event_nameINassign.send_survey,record.send_survey^active=true&sysparm_fields=name,event_name'
    );
    if (!invites.length) {
      record('BLOCKER', 'Surveys', 'No active notification on assign.send_survey or record.send_survey; assignment emails will not send');
      return;
    }
    record('OK', 'Surveys', `Assignment notification active: ${invites.map((i) => `${i.name} (${i.event_name})`).join(', ')}`);
  });
}

async function checkEmail() {
  await safe('Email', async () => {
    const prop = await snGet('sys_properties', 'sysparm_query=name=glide.email.smtp.active&sysparm_fields=value');
    const value = prop.length ? prop[0].value : '(unset)';
    record(
      value === 'true' ? 'OK' : 'WARNING',
      'Email',
      value === 'true'
        ? 'Outbound email enabled'
        : `glide.email.smtp.active=${value}; notifications will be logged to sys_email but not delivered. Deploy leaves this alone unless run with --enable-email`
    );
  });

  await safe('Email', async () => {
    const conflicts = await snGet(
      'sysevent_email_action',
      'sysparm_query=nameSTARTSWITHCSAT Survey Submitted&sysparm_fields=name'
    );
    if (conflicts.length)
      record('WARNING', 'Email', `${conflicts.length} CSAT notification(s) already exist and will be updated in place`);
  });
}

async function checkData() {
  await safe('Data', async () => {
    const companies = await snGet('core_company', 'sysparm_query=name!=N/A&sysparm_fields=sys_id&sysparm_limit=500');
    record(
      companies.length ? 'OK' : 'WARNING',
      'Data',
      companies.length ? `${companies.length} companies available to select` : 'No core_company records; the company picker will be empty'
    );
  });

  await safe('Data', async () => {
    const users = await snGet(
      'sys_user',
      'sysparm_query=active=true^companyISNOTEMPTY^emailISNOTEMPTY&sysparm_fields=sys_id&sysparm_limit=500'
    );
    record(
      users.length ? 'OK' : 'WARNING',
      'Data',
      users.length
        ? `${users.length}+ active users have both a company and an email address`
        : 'No active users with company and email; requests will produce zero recipients'
    );
  });
}

async function checkExistingArtifacts() {
  await safe('Existing artifacts', async () => {
    const tables = await snGet('sys_db_object', 'sysparm_query=nameSTARTSWITHu_x_csat&sysparm_fields=name');
    if (tables.length)
      record('WARNING', 'Existing artifacts', `CSAT tables already present (${tables.map((t) => t.name).join(', ')}); deploy is idempotent and will reuse them`);
    else record('OK', 'Existing artifacts', 'No CSAT tables yet; a clean install');
  });
}

async function main() {
  console.log(`Preflight check for ${base}\n`);

  await checkAuthAndRoles();
  await checkServicePortal();
  await checkSurveyPlatform();
  await checkReporting();
  await checkEmail();
  await checkData();
  await checkExistingArtifacts();

  const order = { BLOCKER: 0, WARNING: 1, OK: 2 };
  results.sort((a, b) => order[a.level] - order[b.level]);

  for (const r of results) console.log(`  ${r.level.padEnd(8)} ${r.area.padEnd(20)} ${r.detail}`);

  const blockers = results.filter((r) => r.level === 'BLOCKER').length;
  const warnings = results.filter((r) => r.level === 'WARNING').length;

  console.log(`\n${blockers} blocker(s), ${warnings} warning(s)`);
  if (blockers) {
    console.log('Resolve blockers before running npm run deploy:csat.');
    process.exitCode = 1;
  } else {
    console.log('Ready to deploy: npm run deploy:csat');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
