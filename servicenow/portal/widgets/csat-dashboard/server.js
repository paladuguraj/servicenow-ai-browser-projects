(function() {
    var dashboard = new CSATDashboard();
    data.options = dashboard.getOptions();

    var params = { program: 'case', range: '12m' };
    if (input && input.action === 'load') {
        params = {
            program: input.program,
            range: input.range,
            from: input.from,
            to: input.to,
            survey: input.survey
        };
    } else if ($sp.getParameter('program')) {
        params.program = $sp.getParameter('program');
    }

    data.dashboard = dashboard.getDashboard(params);
})();
