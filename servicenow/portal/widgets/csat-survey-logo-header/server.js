(function() {
  data.showLogo = false;
  data.logoUrl = (gs.getProperty('glide.servlet.uri') || '').replace(/\/+$/, '') + '/csat_logo.png.iix';

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