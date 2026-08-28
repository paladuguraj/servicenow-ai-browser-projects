(function() {
    data.requestTable = 'u_x_csat_survey_request';
    data.executionTable = 'u_x_csat_survey_execution';
    data.newRequestPage = options.new_request_page || 'csat_home';

    // widget-data-table only renders the stock New button when show_new is
    // truthy, so leaving it unset suppresses it and lets this page offer its
    // own action that lands on the request form instead of a bare record.
    data.listWidget = $sp.getWidget('widget-data-table', {
        table: data.requestTable,
        enable_filter: true
    });
})();
