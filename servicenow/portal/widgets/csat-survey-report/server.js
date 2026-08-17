(function() {
    var report = new CSATSurveyReport();

    if (input && input.action === 'run') {
        var filters = {
            metric_type: input.metric_type || '',
            company: input.company || '',
            sent_from: input.sent_from || '',
            sent_to: input.sent_to || '',
            response: input.response || 'all'
        };
        data.results = report.getResults(filters);
        data.breakdown = report.getBreakdown(filters);
        data.filters = filters;
        return;
    }

    data.options = report.getFilterOptions();
    data.results = null;
    data.breakdown = null;
})();
