(function() {
  data.showLogo = false;
  data.logoSrc = '';
  data.logoAlt = 'Network Operations CSAT Survey';

  function getDefaultAttachmentId() {
    return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
  }

  function getPartnerLogoAttachmentId(partnerName) {
    var prop = (gs.getProperty('csat.logo.whitelabel') || '').trim();
    if (!prop) return '';
    try {
      var map = JSON.parse(prop);
      return (map[partnerName] || '').trim();
    } catch (e) {
      return '';
    }
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

  function resolvePartnerName(instanceGr) {
    if (instanceGr.getValue('trigger_table') != 'u_x_csat_survey_request')
      return '';

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(instanceGr.getValue('trigger_id') + ''))
      return '';

    var companyId = requestGr.getValue('u_company');
    if (!companyId) return '';

    var accountGr = new GlideRecord('customer_account');
    if (!accountGr.get(companyId))
      return '';

    var parent = accountGr.account_parent.name + '';
    if (parent && parent != 'null' && parent != 'Direct')
      return parent;

    return accountGr.getValue('name') + '';
  }

  function attachmentToBase64(attachmentId) {
    var attGr = new GlideRecord('sys_attachment');
    if (!attGr.get(attachmentId)) return '';
    var att = new GlideSysAttachment();
    var bytes = att.getBytes(attGr);
    if (!bytes || bytes.length === 0) return '';
    return Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);
  }

  var instanceId = $sp.getParameter('instance_id');
  if (!instanceId) return;

  var instanceGr = new GlideRecord('asmt_assessment_instance');
  if (!instanceGr.get(instanceId)) return;

  var metricTypeName = instanceGr.metric_type.name.toString();
  data.showLogo =
    metricTypeName === 'Managed Network Services Survey - Manual' ||
    metricTypeName === 'Managed Network Services Survey - Automatic';

  if (!data.showLogo) return;

  var partnerName = resolvePartnerName(instanceGr);
  var attachmentId = '';

  if (partnerName && isWhitelabelPartner(partnerName)) {
    attachmentId = getPartnerLogoAttachmentId(partnerName);
  }

  if (!attachmentId)
    attachmentId = getDefaultAttachmentId();

  if (!attachmentId) return;

  data.logoSrc = 'data:image/png;base64,' + attachmentToBase64(attachmentId);
  data.logoAlt = partnerName || 'Network Operations CSAT Survey';
})();