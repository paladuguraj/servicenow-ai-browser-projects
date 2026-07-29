var CSATSurveyAjax = Class.create();
CSATSurveyAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {
    getCompanies: function() {
        return JSON.stringify(new CSATSurveyService().getCompanies());
    },

    getTemplates: function() {
        return JSON.stringify(new CSATSurveyService().getSurveyTemplates());
    },

    getUsers: function() {
        var companyId = this.getParameter('sysparm_company_id');
        return JSON.stringify(new CSATSurveyService().getUsersByCompany(companyId));
    },

    createRequest: function() {
        var payload = {
            company: this.getParameter('sysparm_company'),
            metric_type: this.getParameter('sysparm_metric_type'),
            recipient_mode: this.getParameter('sysparm_recipient_mode'),
            schedule_frequency: this.getParameter('sysparm_schedule_frequency'),
            notes: this.getParameter('sysparm_notes'),
            selected_users: this.getParameter('sysparm_selected_users') ? this.getParameter('sysparm_selected_users').split(',') : [],
            submit: true
        };
        return JSON.stringify(new CSATSurveyService().createSurveyRequest(payload));
    },

    type: 'CSATSurveyAjax'
});
