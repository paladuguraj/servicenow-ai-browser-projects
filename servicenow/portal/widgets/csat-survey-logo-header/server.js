(function() {
  data.showLogo = false;

  var attachmentId = (gs.getProperty('csat.logo.attachment_sys_id') || '').trim();
  if (attachmentId) {
    data.logoUrl = (gs.getProperty('glide.servlet.uri') || '').replace(/\/+$/, '') +
      '/sys_attachment.do?sys_id=' + attachmentId;
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