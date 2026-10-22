(function() {
    var report = new CSATSurveyReport();

    function readFilters() {
        return {
            metric_type: input.metric_type || '',
            company: input.company || '',
            sent_from: input.sent_from || '',
            sent_to: input.sent_to || '',
            response: input.response || 'all'
        };
    }

    if (input && input.action === 'run') {
        var filters = readFilters();
        data.results = report.getResults(filters);
        data.breakdown = report.getBreakdown(filters);
        data.filters = filters;
        data.excelUrl = report.getExcelUrl(filters);
        return;
    }

    if (input && input.action === 'pdf') {
        data.pdf = report.generatePdf(readFilters());
        return;
    }

    data.options = report.getFilterOptions();
    data.results = null;
    data.breakdown = null;
})();
