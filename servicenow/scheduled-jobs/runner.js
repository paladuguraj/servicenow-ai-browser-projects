(function runJob() {
    var service = new CSATSurveyService();
    var processed = service.processDueRequests();
    gs.info('CSAT Survey Request scheduled runner processed ' + processed + ' request(s).');
})();
