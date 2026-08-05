(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Mirrors set_survey_partners_from, but resolves the account from the CSAT
    // survey request rather than a case. Portal-raised surveys have no task_id,
    // so the case lookup used by the original script never matches.

    var FALLBACK = 'support@noc-portal.com';

    function setSender(address) {
        email.setFrom(address);
        email.setReplyTo(address);
    }

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(current.getValue('trigger_id') + '')) {
        setSender(FALLBACK);
        return;
    }

    var companyId = requestGr.getValue('u_company');
    if (!companyId) {
        setSender(FALLBACK);
        return;
    }

    var accountGr = new GlideRecord('customer_account');
    if (!accountGr.get(companyId)) {
        setSender(FALLBACK);
        return;
    }

    var accountName = accountGr.account_parent.name + '';
    if (accountName === '' || accountName === 'null' || accountName === 'Direct')
        accountName = accountGr.getValue('name') + '';

    try {
        var mapping = JSON.parse(gs.getProperty('survey.from.mail') + '');
        var address = mapping[accountName];
        setSender(address ? address.toString() : FALLBACK);
    } catch (e) {
        gs.warn('CSAT survey invitation: could not resolve sender for "' + accountName + '" - ' + e.message);
        setSender(FALLBACK);
    }

})(current, template, email, email_action, event);
