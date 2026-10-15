var CSATSurveyNotification = Class.create();
CSATSurveyNotification.prototype = {
    initialize: function() {},

    REQUEST_TABLE: 'u_x_csat_survey_request',

    /**
     * Surveys created programmatically only get the platform invitation email
     * when the metric type has notify_user enabled. When it is disabled the
     * native dispatch business rules skip the record, so fire the event here.
     */
    notifyAssigned: function(instanceGr) {
        if (!instanceGr || !instanceGr.isValidRecord())
            return false;

        var userId = instanceGr.getValue('user');
        if (!userId)
            return false;

        if (instanceGr.metric_type.notify_user == true)
            return false;

        try {
            var url = new AssessmentUtils().getAssessmentInstanceURL(instanceGr.getUniqueValue());
            gs.eventQueue('assign.send_survey', instanceGr, userId, url);
            return true;
        } catch (e) {
            gs.warn('CSAT survey assignment notification failed: ' + e.message);
            return false;
        }
    },

    notifySubmitted: function(instanceGr, requestGr) {
        if (!instanceGr || !instanceGr.isValidRecord())
            return false;

        var respondentId = instanceGr.getValue('user') || '';
        var requestorId = requestGr && requestGr.isValidRecord() ? requestGr.getValue('u_requested_by') : '';

        gs.eventQueue('csat.survey.submitted', instanceGr, requestorId, respondentId);
        return true;
    },

    type: 'CSATSurveyNotification'
};
