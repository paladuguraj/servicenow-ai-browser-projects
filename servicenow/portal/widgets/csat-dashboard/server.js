(function() {
    var dashboard = new CSATDashboard();

    function readParams() {
        return {
            program: input.program,
            range: input.range,
            from: input.from,
            to: input.to,
            survey: input.survey
        };
    }

    if (input && input.action === 'export') {
        data.export = dashboard.getExportRows(readParams());
        return;
    }

    if (input && input.action === 'pdf') {
        data.pdf = dashboard.generatePdf(readParams());
        return;
    }

    data.options = dashboard.getOptions();

    var params = { program: 'case', range: '12m' };
    if (input && input.action === 'load')
        params = readParams();
    else if ($sp.getParameter('program'))
        params.program = $sp.getParameter('program');

    data.dashboard = dashboard.getDashboard(params);
})();
