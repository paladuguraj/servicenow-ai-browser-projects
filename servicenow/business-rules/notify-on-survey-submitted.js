(function executeRule(current, previous /*null when async*/) {
    if (current.trigger_table != 'u_x_csat_survey_request' || !current.trigger_id)
        return;

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(current.trigger_id))
        return;

    new CSATSurveyNotification().notifySubmitted(current, requestGr);

    var execGr = new GlideRecord('u_x_csat_survey_execution');
    execGr.addQuery('u_assessment_instance', current.getUniqueValue());
    execGr.query();
    if (execGr.next()) {
        execGr.setValue('u_message', 'Survey submitted by recipient');
        execGr.update();
    }
})(current, previous);
