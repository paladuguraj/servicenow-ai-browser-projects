(function() {
  data.showLogo = false;
  data.logoSrc = '';

  var gr = new GlideRecord('db_image');
  gr.addQuery('name', 'csat_logo.png');
  gr.addQuery('active', true);
  gr.query();
  if (gr.next()) {
    var base64 = gr.getValue('image');
    if (base64) {
      data.logoSrc = 'data:image/png;base64,' + base64;
    }
  }

  var instanceId = $sp.getParameter('instance_id');
  if (!instanceId)
    return;

  var instanceGr = new GlideRecord('asmt_assessment_instance');
  if (!instanceGr.get(instanceId))
    return;

  var metricTypeName = instanceGr.metric_type.name.toString();
  data.showLogo =
    metricTypeName === 'Managed Network Services Survey - Manual' ||
    metricTypeName === 'Managed Network Services Survey - Automatic';
})();