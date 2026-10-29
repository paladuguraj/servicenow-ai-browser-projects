(function() {
  data.showLogo = false;
  data.logoSrc = '';
  data.logoAlt = 'Network Operations CSAT Survey';

  function getDefaultAttachmentId() {
    return (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim();
  }

  // White-label means "Is White Label Partner" is ticked on the account.
  // survey.link.whitelabel also lists partners that are not white-label (such
  // as Direct and Fiserv) and only decides the survey link domain.
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
    companyGr.setWorkflow(false);
    if (!companyGr.get(companyId))
      return '';
    var banner = companyGr.getValue('banner_image');
    return banner ? banner.toString() : '';
  }

  function resolvePartnerCandidates(instanceGr) {
    var candidates = [];
    if (instanceGr.getValue('trigger_table') != 'u_x_csat_survey_request')
      return candidates;

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(instanceGr.getValue('trigger_id') + ''))
      return candidates;

    var companyId = requestGr.getValue('u_company');
    if (!companyId) return candidates;

    // Customer contacts cannot see their parent (partner) account through the
    // CSM account query rules, so the lookups skip business rules. Only the
    // partner's logo leaves this script.
    var accountGr = new GlideRecord('customer_account');
    accountGr.setWorkflow(false);
    if (!accountGr.get(companyId))
      return candidates;

    var parentId = accountGr.getValue('account_parent');
    if (parentId) {
      var parentGr = new GlideRecord('customer_account');
      parentGr.setWorkflow(false);
      if (parentGr.get(parentId) && parentGr.getValue('name'))
        candidates.push({ name: parentGr.getValue('name'), companyId: parentId });
    }

    var accountName = accountGr.getValue('name') + '';
    if (accountName && accountName != 'null' && accountName != '')
      candidates.push({ name: accountName, companyId: companyId });

    return candidates;
  }

  function attachmentToBase64(attachmentId) {
    var attGr = new GlideRecord('sys_attachment');
    if (!attGr.get(attachmentId)) return '';
    var att = new GlideSysAttachment();
    var bytes = att.getBytes(attGr);
    if (!bytes || bytes.length === 0) return '';
    var contentType = (attGr.getValue('content_type') || 'image/png').toString();
    var base64 = Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);
    return 'data:' + contentType + ';base64,' + base64;
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

  var candidates = resolvePartnerCandidates(instanceGr);
  var attachmentId = '';
  var partnerName = '';

  var whitelabel = null;
  for (var i = 0; i < candidates.length; i++) {
    if (isWhitelabelPartner(candidates[i].companyId)) {
      whitelabel = candidates[i];
      break;
    }
  }

  // A white-label partner without a banner gets no logo rather than AppDirect's.
  if (whitelabel) {
    attachmentId = getBannerAttachmentId(whitelabel.companyId);
    partnerName = whitelabel.name;
  } else {
    attachmentId = getDefaultAttachmentId();
  }

  if (!attachmentId) {
    data.showLogo = false;
    return;
  }

  data.logoSrc = attachmentToBase64(attachmentId);
  data.logoAlt = partnerName || 'Network Operations CSAT Survey';
})();