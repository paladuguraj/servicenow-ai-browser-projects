(function() {
  data.showLogo = false;
  data.logoSrc = '';

  var attachmentId = (gs.getProperty('csat.logo.attachment_sys_id') || '').trim();
  if (attachmentId) {
    try {
      var attGr = new GlideRecord('sys_attachment');
      if (attGr.get(attachmentId)) {
        var att = new GlideSysAttachment();
        var bytes = att.getBytes(attGr);
        if (bytes && bytes.length > 0) {
          data.logoSrc = 'data:image/png;base64,' +
            Packages.org.apache.commons.codec.binary.Base64.encodeBase64String(bytes);
        }
      }
    } catch (e) {
      gs.warn('CSAT logo header could not read attachment ' + attachmentId + ': ' + e.message);
    }
  }

  var instanceId = $sp.getParameter('instance_id');
  if (!instanceId)
    return;

  var gr = new GlideRecord('asmt_assessment_instance');
  if (!gr.get(instanceId))
    return;

  var metricTypeName = gr.metric_type.name.toString();
  data.showLogo =
    metricTypeName === 'Managed Network Services Survey - Manual' ||
    metricTypeName === 'Managed Network Services Survey - Automatic';
})();