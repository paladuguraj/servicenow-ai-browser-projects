(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the CSAT logo as a centered email header using the sys_attachment URL.
    // The attachment sys_id is stored in the csat.logo.attachment_sys_id property
    // so the same image can be referenced from email and the Service Portal.

    var attachmentId = (gs.getProperty('csat.logo.attachment_sys_id') || '').trim();
    if (!attachmentId) {
        gs.warn('CSAT logo attachment sys_id is not set in csat.logo.attachment_sys_id');
        return;
    }

    var url = (gs.getProperty('glide.servlet.uri') || '').replace(/\/+$/, '') +
        '/sys_attachment.do?sys_id=' + attachmentId;

    template.print(
        '<div style="text-align:center;margin-bottom:24px;">' +
        '<img src="' + url + '" alt="Network Operations CSAT Survey" style="max-width:280px;height:auto;" />' +
        '</div>'
    );

})(current, template, email, email_action, event);