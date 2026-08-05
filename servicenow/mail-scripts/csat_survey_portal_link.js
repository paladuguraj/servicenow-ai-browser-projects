(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Sends recipients to the Service Portal rather than the platform UI.
    // AssessmentUtils().getInstanceLinkHTML() returns a nav_to.do link into
    // assessment_take2.do, which is not appropriate for external contacts.

    var PORTAL = 'csat';
    var base = (gs.getProperty('glide.servlet.uri') + '').replace(/\/+$/, '');
    var url = base + '/' + PORTAL + '?id=take_survey&instance_id=' + current.getUniqueValue();

    template.print(
        '<p style="text-align: left;">' +
        '<a href="' + url + '" ' +
        'style="background:#0b5cab;color:#ffffff;padding:12px 24px;border-radius:4px;' +
        'text-decoration:none;display:inline-block;font-weight:bold;">Take the survey</a>' +
        '</p>'
    );

    // Many corporate mail clients strip styled anchors, so always give the
    // recipient a copyable address as well.
    template.print(
        '<p style="text-align: left; font-size: 12px; color: #666666;">' +
        'If the button does not work, copy this link into your browser:<br/>' +
        url +
        '</p>'
    );

})(current, template, email, email_action, event);
