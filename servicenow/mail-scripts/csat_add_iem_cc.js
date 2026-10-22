(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Copies the IEM escalation mailbox on every survey invitation.
    //
    // Notifications have no CC field — every recipient row is addressed To —
    // so the copy has to be added through the email object here. Nothing is
    // printed, so the body is unchanged.
    //
    // The address lives in a property rather than in this script so it can be
    // changed, or emptied to switch the copy off, without a deployment.

    var address = (gs.getProperty('csat.iem.cc_email') || '').trim();
    if (!address)
        return;

    var recipients = address.split(',');
    for (var i = 0; i < recipients.length; i++) {
        var recipient = recipients[i].trim();
        if (recipient)
            email.addAddress('cc', recipient);
    }

})(current, template, email, email_action, event);
