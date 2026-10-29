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
    // The image is embedded as a base64 data URI so it renders without any
    // external URL that guests or email clients might not reach. The rendered
    // width is fixed at 180 px and left-aligned so all logos look consistent.

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

    function attachmentToBase64(attachmentId) {
        var attGr = new GlideRecord('sys_attachment');
        if (!attGr.get(attachmentId)) {
            gs.warn('CSAT logo attachment not found: ' + attachmentId);
            return { dataUri: '', alt: '' };
        }
        var att = new GlideSysAttachment();
        var bytes = att.getBytes(attGr);
        if (!bytes || bytes.length === 0) {
            gs.warn('CSAT logo attachment has no data: ' + attachmentId);
            return { dataUri: '', alt: '' };
        }
        var contentType = (attGr.getValue('content_type') || 'image/png').toString();
        var base64 = Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);
        return { dataUri: 'data:' + contentType + ';base64,' + base64, alt: attGr.getValue('file_name') + '' };
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

        var image = attachmentToBase64(attachmentId);
        if (!image.dataUri)
            return;

        template.print(
            '<div class="csat-logo" style="text-align:left;margin-bottom:24px;">' +
            '<img src="' + image.dataUri + '" alt="' + GlideStringUtil.escapeHTML(partnerName || 'Network Operations CSAT Survey') + '" ' +
            'style="width:180px;max-width:180px;height:auto;display:block;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT partner logo mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);