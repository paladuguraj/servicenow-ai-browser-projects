(function() {
    var service = new CSATSurveyService();

    if (input && input.action) {
        if (input.action === 'searchCompanies') {
            data.companies = service.getCompanies(input.term, 50);
            return;
        }

        // Eligibility depends on the survey, because the 90-day window runs
        // per survey. The client reloads recipients whenever either the
        // company or the survey changes.
        if (input.action === 'loadRecipients') {
            data.users = service.getUsersByCompany(input.company_id, input.metric_type);
            data.primaryContact = service.getPrimaryContact(input.company_id, input.metric_type);
            return;
        }

        if (input.action === 'createRequest') {
            var selectedUsers = [];
            if (input.selected_users) {
                selectedUsers = String(input.selected_users).split(',').filter(function(id) {
                    return id && id.length;
                });
            }

            data.result = service.createSurveyRequest({
                company: input.company,
                metric_type: input.metric_type,
                // primary_user | selected_users | both
                recipient_mode: input.recipient_mode || 'primary_user',
                schedule_frequency: input.schedule_frequency || 'immediate',
                notes: input.notes || '',
                selected_users: selectedUsers,
                submit: true
            });
            return;
        }
    }

    data.companies = service.getCompanies('', 50);
    data.templates = service.getSurveyTemplates();
    data.scheduleOptions = [
        { value: 'immediate', label: 'Send immediately' },
        { value: 'every_30_days', label: 'Every 30 days' },
        { value: 'every_60_days', label: 'Every 60 days' }
    ];
    data.cooldownDays = service.COOLDOWN_DAYS;
    data.users = [];
    data.primaryContact = null;
    data.message = '';
    data.messageType = '';
})();
