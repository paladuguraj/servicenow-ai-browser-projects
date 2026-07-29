(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    var service = new CSATSurveyService();
    var path = request.pathParams.action;

    if (path === 'companies') {
        return service.getCompanies();
    }

    if (path === 'templates') {
        return service.getSurveyTemplates();
    }

    if (path === 'users') {
        return service.getUsersByCompany(request.queryParams.company_id);
    }

    if (path === 'requests' && request.method === 'post') {
        var body = request.body.data || request.body;
        return service.createSurveyRequest(body);
    }

    response.setStatus(404);
    return { error: 'Unknown endpoint' };
})(request, response);
