(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the CSAT logo as a centered email header using the db_image URL.
    // The image is stored in the db_image table as 'csat_logo.png' and is
    // served from the instance URL so it renders in email clients regardless
    // of any white-label partner domain used for the survey link.

    var url = (gs.getProperty('glide.servlet.uri') || '').replace(/\/+$/, '') + '/csat_logo.png.iix';

    template.print(
        '<div style="text-align:center;margin-bottom:24px;">' +
        '<img src="' + url + '" alt="Network Operations CSAT Survey" style="max-width:280px;height:auto;" />' +
        '</div>'
    );

})(current, template, email, email_action, event);