(function executeRule(current, previous /*null when async*/) {
    // csat_partner_logo_image references the logo as cid:csat-logo-<attachment sys_id>.<ext>
    // because Outlook and Gmail block base64 data: images. This copies that
    // attachment onto the outgoing email as an inline part, so the cid resolves.
    //
    // Only the default logo and partner banner images may be copied, so a body
    // naming any other attachment cannot pull it into an email.

    var body = current.getValue('body') || '';
    var pattern = /cid:(csat-logo-([0-9a-f]{32})\.[a-z]+)/g;
    var done = {};
    var match;

    function isAllowedLogo(attachmentGr) {
        var id = attachmentGr.getUniqueValue();
        if (id == (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim())
            return true;
        var company = new GlideRecord('core_company');
        company.setWorkflow(false);
        company.addQuery('banner_image', id);
        company.setLimit(1);
        company.query();
        return company.hasNext();
    }

    while ((match = pattern.exec(body)) !== null) {
        var fileName = match[1];
        if (done[fileName])
            continue;
        done[fileName] = true;

        var source = new GlideRecord('sys_attachment');
        if (!source.get(match[2]) || !isAllowedLogo(source)) {
            gs.warn('CSAT inline logo: attachment ' + match[2] + ' not found or not a logo');
            continue;
        }

        var gsa = new GlideSysAttachment();
        // getContentBase64/writeBase64 are scoped-only; the stream API works in global.
        var copyId = gsa.writeContentStream(current, fileName, source.getValue('content_type'), gsa.getContentStream(source.getUniqueValue()));
        if (!copyId) {
            gs.warn('CSAT inline logo: could not attach ' + fileName + ' to ' + current.getUniqueValue());
            continue;
        }

        var link = new GlideRecord('sys_email_attachment');
        link.initialize();
        link.setValue('email', current.getUniqueValue());
        link.setValue('attachment', copyId);
        link.setValue('file_name', fileName);
        link.setValue('content_disposition', 'inline');
        link.setValue('source', 'notification');
        link.insert();
    }
})(current, previous);
