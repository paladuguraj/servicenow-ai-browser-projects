(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the partner-branded logo for the CSAT email header.
    //
    // For surveys raised from the CSAT portal, the customer's account parent is
    // treated as the partner. If that partner appears in the white-label list
    // (survey.link.whitelabel) and a logo is configured for them in
    // csat.logo.whitelabel, that logo is used. Otherwise the AppDirect logo is
    // shown.
    //
    // The image is embedded as a base64 data URI so it renders without any
    // external URL that guests or email clients might not reach.

    function getDefaultAttachmentId() {
        return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
    }

    function resolvePartnerName() {
        if (current.getValue('trigger_table') != 'u_x_csat_survey_request')
            return '';

        var requestGr = new GlideRecord('u_x_csat_survey_request');
        if (!requestGr.get(current.getValue('trigger_id') + ''))
            return '';

        var companyId = requestGr.getValue('u_company');
        if (!companyId)
            return '';

        var accountGr = new GlideRecord('customer_account');
        if (!accountGr.get(companyId))
            return '';

        var parent = accountGr.account_parent.name + '';
        if (parent && parent != 'null' && parent != 'Direct')
            return parent;

        return accountGr.getValue('name') + '';
    }

    function isWhitelabelPartner(partnerName) {
        var prop = (gs.getProperty('survey.link.whitelabel') || '').trim();
        if (!prop) return false;
        try {
            var map = JSON.parse(prop);
            return map.hasOwnProperty(partnerName);
        } catch (e) {
            gs.warn('survey.link.whitelabel could not be parsed: ' + e.message);
            return false;
        }
    }

    function getPartnerLogoAttachmentId(partnerName) {
        var prop = (gs.getProperty('csat.logo.whitelabel') || '').trim();
        if (!prop) return '';
        try {
            var map = JSON.parse(prop);
            return (map[partnerName] || '').trim();
        } catch (e) {
            gs.warn('csat.logo.whitelabel could not be parsed: ' + e.message);
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
        var partnerName = resolvePartnerName();
        var attachmentId = '';

        if (partnerName && isWhitelabelPartner(partnerName)) {
            attachmentId = getPartnerLogoAttachmentId(partnerName);
        }

        if (!attachmentId)
            attachmentId = getDefaultAttachmentId();

        if (!attachmentId) {
            gs.warn('No CSAT logo attachment configured. Set csat.logo.default_attachment_sys_id and csat.logo.whitelabel.');
            return;
        }

        var base64 = attachmentToBase64(attachmentId);
        if (!base64)
            return;

        template.print(
            '<div class="csat-logo" style="text-align:left;margin-bottom:24px;">' +
            '<img src="data:image/png;base64,' + base64 + '" alt="' + GlideStringUtil.escapeHTML(partnerName || 'Network Operations CSAT Survey') + '" style="width:180px;max-width:180px;height:auto;" />' +
            '</div>'
        );
    } catch (e) {
        gs.error('CSAT partner logo mail script failed: ' + e.message);
    }

})(current, template, email, email_action, event);