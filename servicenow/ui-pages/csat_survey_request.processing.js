(function process(request, response) {
    var action = request.getParameter('sysparm_action');
    if (!action)
        return;

    var service = new CSATSurveyService();
    response.setContentType('application/json');

    try {
        if (action === 'getCompanies') {
            response.getWriter().write(new global.JSON().encode(service.getCompanies()));
            return;
        }

        if (action === 'getSurveyTemplates') {
            response.getWriter().write(new global.JSON().encode(service.getSurveyTemplates()));
            return;
        }

        if (action === 'getUsersByCompany') {
            var companyId = request.getParameter('company_id');
            response.getWriter().write(new global.JSON().encode(service.getUsersByCompany(companyId)));
            return;
        }

        if (action === 'createSurveyRequest') {
            var selectedUsersParam = request.getParameter('selected_users') || '';
            var selectedUsers = [];
            if (selectedUsersParam) {
                selectedUsers = selectedUsersParam.split(',');
            }

            var payload = {
                company: request.getParameter('company'),
                metric_type: request.getParameter('metric_type'),
                recipient_mode: request.getParameter('recipient_mode'),
                schedule_frequency: request.getParameter('schedule_frequency'),
                notes: request.getParameter('notes'),
                selected_users: selectedUsers,
                submit: request.getParameter('submit')
            };

            var result = service.createSurveyRequest(payload);
            response.getWriter().write(new global.JSON().encode(result));
            return;
        }

        response.getWriter().write('{"error":"Unknown action"}');
    } catch (e) {
        response.setStatus(500);
        response.getWriter().write(new global.JSON().encode({ error: e.message }));
    }
})(request, response);
