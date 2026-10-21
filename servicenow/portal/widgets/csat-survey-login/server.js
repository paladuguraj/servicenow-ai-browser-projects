(function() {
  // Survey links send customers through the same identity provider as the
  // case survey on /service. Every other CSAT page keeps the standard login
  // form, because staff use this portal to raise survey requests.
  var SURVEY_DESTINATION = /^\/csat\?id=csat_take_survey(&[A-Za-z0-9_=&%.-]*)?$/;

  if (input && input.action === 'set_destination') {
    if (input.destination && SURVEY_DESTINATION.test(input.destination)) {
      gs.getSession().putProperty('is_direct_redirect', 'true');
      gs.getSession().putProperty('starting_page', input.destination);
    }
    return;
  }

  data.ssoId = '';
  var idpName = (gs.getProperty('csat.survey.login.idp_name') || '').trim();
  if (idpName) {
    var idp = new GlideRecord('sso_properties');
    idp.addQuery('name', idpName);
    idp.addActiveQuery();
    idp.setLimit(1);
    idp.query();
    if (idp.next())
      data.ssoId = idp.getUniqueValue();
  }

  data.loginWidget = $sp.getWidget('widget-login', {});
})();
