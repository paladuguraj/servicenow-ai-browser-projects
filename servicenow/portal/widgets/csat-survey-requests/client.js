api.controller = function() {
    var c = this;
    c.newRequestUrl = '?id=' + (c.data.newRequestPage || 'csat_home');
};
