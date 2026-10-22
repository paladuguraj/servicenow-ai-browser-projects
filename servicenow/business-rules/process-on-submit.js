(function executeRule(current, previous /*null when async*/) {
    if (current.operation() !== 'insert' && current.operation() !== 'update')
        return;

    if (current.u_state.changesTo('active') && current.getValue('u_state') === 'active') {
        var service = new CSATSurveyService();
        if (current.getValue('u_schedule_frequency') === 'immediate') {
            service.executeRequest(current.getUniqueValue());
        } else if (!current.getValue('u_next_run')) {
            current.u_next_run = new GlideDateTime();
        }
    }
})(current, previous);
