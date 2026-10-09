(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the partner-branded logo for the CSAT email header.
    //
    // For surveys raised from the CSAT portal, the customer's parent company is
    // treated as the partner. If that partner is a white-label partner (listed
    // in survey.link.whitelabel) and has a banner_image on core_company, that
    // banner is used. Otherwise the default AppDirect logo is shown.
    //
    // The csat.logo.whitelabel property can still override the partner logo by
    // mapping partner name -> sys_attachment sys_id.
    //
    // The image is embedded as a base64 data URI so it renders without any
    // external URL that guests or email clients might not reach.

    function getDefaultAttachmentId() {
        return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
    }

    function resolvePartner() {
        var result = { name: '', companyId: '', requestId: '' };
        if (current.getValue('trigger_table') != 'u_x_csat_survey_request')
            return result;

        var requestGr = new GlideRecord('u_x_csat_survey_request');
        if (!requestGr.get(current.getValue('trigger_id') + ''))
            return result;

        result.requestId = requestGr.sys_id.toString();
        var companyId = requestGr.getValue('u_company');
        if (!companyId)
            return result;

        var accountGr = new GlideRecord('core_company');
        if (!accountGr.get(companyId))
            return result;

        result.companyId = companyId;
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

    function getPropertyOverrideAttachmentId(partnerName) {
        var prop = (gs.getProperty('csat.logo.whitelabel') || '').trim();
        if (!prop) return '';
        try {
            var map = JSON.parse(prop);
            return (map[partnerName] || '').trim();
        } catch (e) {
            return '';
        }
    }

    function attachmentToBase64(attachmentId) {
        var attGr = new GlideRecord('sys_attachment');
        if (!attGr.get(attachmentId)) {
            gs.warn('CSAT logo attachment not found: ' + attachmentId);
            return '';
        }
        var att = new GlideSysAttachment();
        var bytes = att.getBytes(attGr);
        if (!bytes || bytes.length === 0) {
            gs.warn('CSAT logo attachment has no data: ' + attachmentId);
            return '';
        }
        return Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);
    }

    try {
        var partner = resolvePartner();
        var attachmentId = '';

        if (partner.name && isWhitelabelPartner(partner.name)) {
            attachmentId = getPropertyOverrideAttachmentId(partner.name);
            if (!attachmentId)
                attachmentId = getBannerAttachmentId(partner.companyId);
        }

        if (!attachmentId)
            attachmentId = getDefaultAttachmentId();

        if (!attachmentId) {
            gs.warn('No CSAT logo attachment configured. Set csat.logo.default_attachment_sys_id.');
            return;
        }

        var base64 = attachmentToBase64(attachmentId);
        if (!base64)
            return;

        template.print(
            '<div class="csat-logo" style="text-align:left;margin-bottom:24px;">' +
            '<img src="data:image/png;base64,' + base64 + '" alt="' + GlideStringUtil.escapeHTML(partner.name || 'Network Operations CSAT Survey') + '" style="width:180px;max-width:180px;height:auto;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT partner logo mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);