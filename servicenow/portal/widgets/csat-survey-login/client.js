function($location, $window) {
  var c = this;

  c.redirecting = !!c.data.ssoId && $location.search().id === 'csat_take_survey';

  if (c.redirecting) {
    c.server.get({
      action: 'set_destination',
      destination: $window.location.pathname + $window.location.search
    }).then(function() {
      $window.location = '/login_with_sso.do?glide_sso_id=' + c.data.ssoId;
    });
  }
}
