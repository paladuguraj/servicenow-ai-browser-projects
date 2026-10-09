(function() {
  data.showLogo = false;
  data.logoSrc = '';
  data.logoAlt = 'Network Operations CSAT Survey';

  function getDefaultAttachmentId() {
    return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
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

  function resolvePartner(instanceGr) {
    var result = { name: '', companyId: '' };
    if (instanceGr.getValue('trigger_table') != 'u_x_csat_survey_request')
      return result;

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(instanceGr.getValue('trigger_id') + ''))
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

  var partner = resolvePartner(instanceGr);
  var attachmentId = '';

  if (partner.name && isWhitelabelPartner(partner.name)) {
    attachmentId = getPropertyOverrideAttachmentId(partner.name);
    if (!attachmentId)
      attachmentId = getBannerAttachmentId(partner.companyId);
  }

  if (!attachmentId)
    attachmentId = getDefaultAttachmentId();

  if (!attachmentId) return;

  data.logoSrc = 'data:image/png;base64,' + attachmentToBase64(attachmentId);
  data.logoAlt = partner.name || 'Network Operations CSAT Survey';
})();