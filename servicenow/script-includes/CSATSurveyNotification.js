var CSATSurveyNotification = Class.create();
CSATSurveyNotification.prototype = {
    initialize: function() {},

    notifyAssigned: function(instanceGr) {
        if (!instanceGr || !instanceGr.isValidRecord())
            return;
        if (instanceGr.getValue('trigger_table') !== 'u_x_csat_survey_request')
            return;

        try {
            var url = new AssessmentUtils().getAssessmentInstanceURL(instanceGr.getUniqueValue());
            var userId = instanceGr.getValue('user');
            if (!userId)
                return;

            if (instanceGr.getValue('trigger_id'))
                gs.eventQueue('record.send_survey', instanceGr, userId, url);
            else
                gs.eventQueue('assign.send_survey', instanceGr, userId, url);
        } catch (e) {
            gs.warn('CSAT survey assignment notification failed: ' + e.message);
        }
    },

    notifySubmitted: function(instanceGr, requestGr) {
        if (!instanceGr || !instanceGr.isValidRecord())
            return;

        var metricName = instanceGr.metric_type.getDisplayValue();
        var respondent = instanceGr.user.getRefRecord();
        var takenOn = instanceGr.getDisplayValue('taken_on') || new GlideDateTime().getDisplayValue();

        if (respondent.isValidRecord())
            this._sendEmail(
                respondent,
                'Thank you for completing ' + metricName,
                this._buildBody(
                    'Hi ' + respondent.getDisplayValue() + ',',
                    'Thank you for completing the <strong>' + metricName + '</strong> survey.',
                    'Your feedback helps us improve our services.'
                )
            );

        if (requestGr && requestGr.isValidRecord()) {
            var requestor = requestGr.u_requested_by.getRefRecord();
            if (requestor.isValidRecord()) {
                this._sendEmail(
                    requestor,
                    'CSAT survey submitted: ' + metricName,
                    this._buildBody(
                        'Hello ' + requestor.getDisplayValue() + ',',
                        'A CSAT survey response was submitted for <strong>' + metricName + '</strong>.',
                        '<strong>Respondent:</strong> ' + respondent.getDisplayValue() + '<br/>' +
                        '<strong>Completed:</strong> ' + takenOn + '<br/>' +
                        '<strong>Request:</strong> ' + requestGr.getDisplayValue()
                    )
                );
            }
        }
    },

    _buildBody: function(greeting, line1, line2) {
        return '<p>' + greeting + '</p><p>' + line1 + '</p><p>' + line2 + '</p>';
    },

    _sendEmail: function(userGr, subject, bodyHtml) {
        if (!userGr || !userGr.isValidRecord())
            return;
        var address = userGr.getValue('email');
        if (!address)
            return;

        var email = new GlideEmail();
        email.setSubject(subject);
        email.setBody(bodyHtml);
        email.addAddress('to', address, userGr.getDisplayValue());
        email.send();
    },

    type: 'CSATSurveyNotification'
};
