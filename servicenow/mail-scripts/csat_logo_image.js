(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    try {
        var attachmentId = (gs.getProperty('csat.logo.attachment_sys_id') || '').trim();
        if (!attachmentId) {
            gs.warn('CSAT logo attachment sys_id is not set in csat.logo.attachment_sys_id');
            return;
        }

        var attGr = new GlideRecord('sys_attachment');
        if (!attGr.get(attachmentId)) {
            gs.warn('CSAT logo attachment not found: ' + attachmentId);
            return;
        }

        var att = new GlideSysAttachment();
        var bytes = att.getBytes(attGr);
        if (!bytes || bytes.length === 0) {
            gs.warn('CSAT logo attachment has no data: ' + attachmentId);
            return;
        }

        var base64 = Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);

        template.print(
            '<div style="text-align:center;margin-bottom:24px;">' +
            '<img src="data:image/png;base64,' + base64 + '" alt="Network Operations CSAT Survey" style="max-width:280px;height:auto;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT logo image mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);