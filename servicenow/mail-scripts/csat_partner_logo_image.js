(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the partner-branded or AppDirect logo for the CSAT email header.
    //
    // For surveys raised from the CSAT portal, the customer's parent account is
    // treated as the partner. If that partner is a white-label partner ("Is White
    // Label Partner" ticked on the account), its banner_image is used, and when
    // it has no banner no logo is shown at all, so a white-label customer never
    // sees AppDirect branding. Every other customer gets the AppDirect logo.
    //
    // survey.link.whitelabel is not used here: it also lists partners that are
    // not white-label (such as Direct and Fiserv), and only decides the survey
    // link domain.
    //
    // The parent account is tried first, then the account itself, so an account
    // that is itself a white-label partner still shows its own logo.
    //
    // The image is sent as an inline (cid:) attachment, which the "CSAT Email -
    // Attach Inline Logo" business rule adds to the outgoing email. Outlook and
    // Gmail block base64 data: images, and instance URLs need a login. The cid
    // does not resolve in ServiceNow's own email preview, only in the delivered
    // email. The rendered width is fixed at 180 px and left-aligned so all logos
    // look consistent.

    function getDefaultAttachmentId() {
        return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
    }

    function resolvePartnerCandidates() {
        var candidates = [];
        if (current.getValue('trigger_table') != 'u_x_csat_survey_request')
            return candidates;

        var requestGr = new GlideRecord('u_x_csat_survey_request');
        if (!requestGr.get(current.getValue('trigger_id') + ''))
            return candidates;

        var companyId = requestGr.getValue('u_company');
        if (!companyId) return candidates;

        var accountGr = new GlideRecord('customer_account');
        if (!accountGr.get(companyId))
            return candidates;

        var parentName = accountGr.account_parent.name + '';
        if (parentName && parentName != 'null' && parentName != '')
            candidates.push({ name: parentName, companyId: accountGr.getValue('account_parent') });

        var accountName = accountGr.getValue('name') + '';
        if (accountName && accountName != 'null' && accountName != '')
            candidates.push({ name: accountName, companyId: companyId });

        return candidates;
    }

    function isWhitelabelPartner(companyId) {
        var accountGr = new GlideRecord('customer_account');
        accountGr.setWorkflow(false);
        if (!accountGr.get(companyId))
            return false;
        var flag = accountGr.getValue('u_is_white_label_partner');
        return flag == '1' || flag == 'true';
    }

    function getBannerAttachmentId(companyId) {
        var companyGr = new GlideRecord('core_company');
        if (!companyGr.get(companyId))
            return '';
        var banner = companyGr.getValue('banner_image');
        return banner ? banner.toString() : '';
    }

    // Content-ID of the inline part; the business rule matches this exact form.
    // File names must not contain spaces for cid references to resolve.
    function inlineFileName(attachmentId) {
        var attGr = new GlideRecord('sys_attachment');
        if (!attGr.get(attachmentId)) {
            gs.warn('CSAT logo attachment not found: ' + attachmentId);
            return '';
        }
        var contentType = (attGr.getValue('content_type') || '').toLowerCase();
        var ext = contentType.indexOf('png') > -1 ? 'png' :
            contentType.indexOf('gif') > -1 ? 'gif' :
            contentType.indexOf('jpeg') > -1 || contentType.indexOf('jpg') > -1 ? 'jpg' : '';
        if (!ext) {
            gs.warn('CSAT logo attachment is not a png, jpeg or gif: ' + attachmentId);
            return '';
        }
        return 'csat-logo-' + attachmentId + '.' + ext;
    }

    try {
        var candidates = resolvePartnerCandidates();
        var attachmentId = '';
        var partnerName = '';

        var whitelabel = null;
        for (var i = 0; i < candidates.length; i++) {
            if (isWhitelabelPartner(candidates[i].companyId)) {
                whitelabel = candidates[i];
                break;
            }
        }

        if (whitelabel) {
            attachmentId = getBannerAttachmentId(whitelabel.companyId);
            partnerName = whitelabel.name;
            if (!attachmentId)
                return;
        } else {
            attachmentId = getDefaultAttachmentId();
        }

        if (!attachmentId) {
            gs.warn('No CSAT logo attachment configured. Set csat.logo.default_attachment_sys_id.');
            return;
        }

        var fileName = inlineFileName(attachmentId);
        if (!fileName)
            return;

        template.print(
            '<div class="csat-logo" style="text-align:left;margin-bottom:24px;">' +
            '<img src="cid:' + fileName + '" alt="' + GlideStringUtil.escapeHTML(partnerName || 'Network Operations CSAT Survey') + '" ' +
            'style="width:180px;max-width:180px;height:auto;display:block;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT partner logo mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);