(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Sets the sender for the "Survey User Invite v2- Manually Created"
    // template. The original resolved the account from the triggering case,
    // which surveys raised from the CSAT portal do not have, so those fell
    // through and kept the instance default sender.
    //
    // The case path below is unchanged. A fallback resolves the account from
    // the CSAT survey request so portal invitations use the same mapping.

    var FALLBACK = 'support@noc-portal.com';

    function applyMapping(accountName) {
        if (accountName == '' || accountName == 'Direct')
            accountName = 'Direct';

        var from_email_prop = gs.getProperty('survey.from.mail') + '';
        var from_email;
        try {
            from_email = JSON.parse(from_email_prop)[accountName];
        } catch (e) {
            gs.warn('survey.from.mail could not be parsed: ' + e.message);
        }

        if (from_email != undefined) {
            var mailId = from_email.toString();
            email.setFrom(mailId);
            email.setReplyTo(mailId);
        } else {
            email.setFrom(FALLBACK);
            email.setReplyTo(FALLBACK);
        }
    }

    var triggers = current.trigger_id;
    var triggeredCase = new GlideRecord('sn_customerservice_case');
    triggeredCase.addQuery('sys_id', triggers);
    triggeredCase.query();
    if (triggeredCase.next()) {

        var contact_account = triggeredCase.contact.account.account_parent.name + '';
        if (contact_account == '' || contact_account == 'Direct') {
            contact_account = triggeredCase.contact.account.name + '';
        }
        applyMapping(contact_account);
        return;
    }

    if (current.getValue('trigger_table') == 'u_x_csat_survey_request') {
        var requestGr = new GlideRecord('u_x_csat_survey_request');
        if (!requestGr.get(current.getValue('trigger_id') + '')) {
            applyMapping('');
            return;
        }

        var accountGr = new GlideRecord('customer_account');
        if (!accountGr.get(requestGr.getValue('u_company'))) {
            applyMapping('');
            return;
        }

        var portal_account = accountGr.account_parent.name + '';
        if (portal_account == '' || portal_account == 'null' || portal_account == 'Direct')
            portal_account = accountGr.getValue('name') + '';

        applyMapping(portal_account);
    }

})(current, template, email, email_action, event);
