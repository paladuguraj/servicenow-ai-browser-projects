(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the partner-branded or AppDirect logo for the CSAT email header.
    //
    // For surveys raised from the CSAT portal, the customer's parent company is
    // treated as the partner. If that partner is a white-label partner (listed in
    // survey.link.whitelabel) and has a banner_image on core_company, that banner
    // is used. Otherwise the AppDirect logo is shown.
    //
    // The image is embedded as a base64 data URI so it renders without any
    // external URL that guests or email clients might not reach. The rendered
    // width is fixed at 180 px and left-aligned so all logos look consistent.

    function getDefaultAttachmentId() {
        return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
    }

    function resolvePartner() {
        var result = { name: '', companyId: '' };
        if (current.getValue('trigger_table') != 'u_x_csat_survey_request')
            return result;

        var requestGr = new GlideRecord('u_x_csat_survey_request');
        if (!requestGr.get(current.getValue('trigger_id') + ''))
            return result;

        var companyId = requestGr.getValue('u_company');
        if (!companyId) return result;

        var accountGr = new GlideRecord('core_company');
        if (!accountGr.get(companyId))
            return result;

        var parentId = accountGr.getValue('parent');
        if (parentId) {
            var parentGr = new GlideRecord('core_company');
            if (parentGr.get(parentId)) {
                result.name = parentGr.getValue('name') + '';
                result.companyId = parentId;
                return result;
            }
        }

        result.name = accountGr.getValue('name') + '';
        result.companyId = companyId;
        return result;
    }

    function isWhitelabelPartner(partnerName) {
        var prop = (gs.getProperty('survey.link.whitelabel') || '').trim();
        if (!prop) return false;
        try {
            var map = JSON.parse(prop);
            return map.hasOwnProperty(partnerName);
        } catch (e) {
            return false;
        }
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
        var partner = resolvePartner();
        var attachmentId = '';

        if (partner.name && isWhitelabelPartner(partner.name)) {
            attachmentId = getBannerAttachmentId(partner.companyId);
        }

        if (!attachmentId)
            attachmentId = getDefaultAttachmentId();

        if (!attachmentId) {
            gs.warn('No CSAT logo attachment configured. Set csat.logo.default_attachment_sys_id.');
            return;
        }

        var image = attachmentToBase64(attachmentId);
        if (!image.dataUri)
            return;

        template.print(
            '<div class="csat-logo" style="text-align:left;margin-bottom:24px;">' +
            '<img src="' + image.dataUri + '" alt="' + GlideStringUtil.escapeHTML(partner.name || 'Network Operations CSAT Survey') + '" ' +
            'style="width:180px;max-width:180px;height:auto;display:block;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT partner logo mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);