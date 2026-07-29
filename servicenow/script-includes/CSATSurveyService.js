var CSATSurveyService = Class.create();
CSATSurveyService.prototype = {
    initialize: function() {},

    REQUEST_TABLE: 'u_x_csat_survey_request',
    REQUEST_USER_TABLE: 'u_x_csat_survey_request_user',
    EXECUTION_TABLE: 'u_x_csat_survey_execution',

    F: {
        company: 'u_company',
        metric_type: 'u_metric_type',
        recipient_mode: 'u_recipient_mode',
        schedule_frequency: 'u_schedule_frequency',
        state: 'u_state',
        next_run: 'u_next_run',
        last_run: 'u_last_run',
        requested_by: 'u_requested_by',
        notes: 'u_notes',
        active: 'u_active',
        number: 'u_number',
        survey_request: 'u_survey_request',
        user: 'u_user',
        assessment_instance: 'u_assessment_instance',
        status: 'u_status',
        message: 'u_message',
        executed_on: 'u_executed_on',
        scheduled_for: 'u_scheduled_for'
    },

    getCompanies: function() {
        var companies = [];
        var gr = new GlideRecord('core_company');
        gr.addQuery('name', '!=', 'N/A');
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            companies.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name')
            });
        }
        return companies;
    },

    getSurveyTemplates: function() {
        var templates = [];
        var gr = new GlideRecord('asmt_metric_type');
        gr.addQuery('active', true);
        gr.addQuery('evaluation_method', 'survey');
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            templates.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                description: gr.getValue('description') || ''
            });
        }
        return templates;
    },

    getUsersByCompany: function(companyId) {
        var users = [];
        if (!companyId)
            return users;

        var gr = new GlideRecord('sys_user');
        gr.addQuery('active', true);
        gr.addQuery('company', companyId);
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            users.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                user_name: gr.getValue('user_name'),
                email: gr.getValue('email')
            });
        }
        return users;
    },

    createSurveyRequest: function(payload) {
        var F = this.F;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        requestGr.initialize();
        requestGr.setValue(F.company, payload.company);
        requestGr.setValue(F.metric_type, payload.metric_type);
        requestGr.setValue(F.recipient_mode, payload.recipient_mode || 'all_users');
        requestGr.setValue(F.schedule_frequency, payload.schedule_frequency || 'immediate');
        requestGr.setValue(F.notes, payload.notes || '');
        requestGr.setValue(F.requested_by, gs.getUserID());
        requestGr.setValue(F.state, 'draft');
        requestGr.setValue(F.active, true);

        if (payload.schedule_frequency === 'immediate') {
            requestGr.setValue(F.next_run, new GlideDateTime());
        }

        var requestId = requestGr.insert();
        if (!requestId)
            throw new Error('Failed to create survey request record');

        if (payload.recipient_mode === 'selected_users' && payload.selected_users) {
            for (var i = 0; i < payload.selected_users.length; i++) {
                var userId = payload.selected_users[i];
                var userGr = new GlideRecord(this.REQUEST_USER_TABLE);
                userGr.initialize();
                userGr.setValue(F.survey_request, requestId);
                userGr.setValue(F.user, userId);
                userGr.insert();
            }
        }

        if (payload.submit === true || payload.submit === 'true') {
            this.activateRequest(requestId);
        }

        return this.getRequestSummary(requestId);
    },

    activateRequest: function(requestId) {
        var F = this.F;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        if (!requestGr.get(requestId))
            throw new Error('Survey request not found');

        requestGr.setValue(F.state, 'active');
        if (!requestGr.getValue(F.next_run)) {
            requestGr.setValue(F.next_run, new GlideDateTime());
        }
        requestGr.update();

        if (requestGr.getValue(F.schedule_frequency) === 'immediate') {
            this.executeRequest(requestId);
        }
    },

    getRecipients: function(requestGr) {
        var F = this.F;
        var recipients = [];
        var mode = requestGr.getValue(F.recipient_mode);

        if (mode === 'selected_users') {
            var rel = new GlideRecord(this.REQUEST_USER_TABLE);
            rel.addQuery(F.survey_request, requestGr.getUniqueValue());
            rel.query();
            while (rel.next()) {
                recipients.push(rel.getValue(F.user));
            }
            return recipients;
        }

        var userGr = new GlideRecord('sys_user');
        userGr.addQuery('active', true);
        userGr.addQuery('company', requestGr.getValue(F.company));
        userGr.query();
        while (userGr.next()) {
            recipients.push(userGr.getUniqueValue());
        }
        return recipients;
    },

    executeRequest: function(requestId) {
        var F = this.F;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        if (!requestGr.get(requestId))
            throw new Error('Survey request not found');

        var state = requestGr.getValue(F.state);
        if (state === 'cancelled' || state === 'completed')
            return { executed: 0, skipped: 0, failed: 0 };

        var recipients = this.getRecipients(requestGr);
        var metricTypeId = requestGr.getValue(F.metric_type);
        var executed = 0;
        var skipped = 0;
        var failed = 0;

        for (var i = 0; i < recipients.length; i++) {
            var userId = recipients[i];
            var result = this._sendSurveyToUser(requestGr, metricTypeId, userId, requestId);
            if (result.status === 'success')
                executed++;
            else if (result.status === 'skipped')
                skipped++;
            else
                failed++;
        }

        var now = new GlideDateTime();
        requestGr.setValue(F.last_run, now);

        var frequency = requestGr.getValue(F.schedule_frequency);
        if (frequency === 'every_30_days') {
            var next30 = new GlideDateTime();
            next30.addDaysUTC(30);
            requestGr.setValue(F.next_run, next30);
            requestGr.setValue(F.state, 'active');
        } else if (frequency === 'every_60_days') {
            var next60 = new GlideDateTime();
            next60.addDaysUTC(60);
            requestGr.setValue(F.next_run, next60);
            requestGr.setValue(F.state, 'active');
        } else {
            requestGr.setValue(F.state, 'completed');
            requestGr.setValue(F.next_run, '');
        }

        requestGr.update();

        return { executed: executed, skipped: skipped, failed: failed };
    },

    _sendSurveyToUser: function(requestGr, metricTypeId, userId, sourceRecordId) {
        var F = this.F;
        var execGr = new GlideRecord(this.EXECUTION_TABLE);
        execGr.initialize();
        execGr.setValue(F.survey_request, requestGr.getUniqueValue());
        execGr.setValue(F.user, userId);
        execGr.setValue(F.metric_type, metricTypeId);
        execGr.setValue(F.scheduled_for, new GlideDateTime());
        execGr.setValue(F.status, 'pending');
        var execId = execGr.insert();

        try {
            var userGr = new GlideRecord('sys_user');
            if (!userGr.get(userId)) {
                return this._finalizeExecution(execId, 'failed', 'Recipient user not found');
            }

            if (!userGr.getValue('email')) {
                return this._finalizeExecution(execId, 'skipped', 'Recipient has no email address');
            }

            var result = new SNC.AssessmentCreation().createAssessments(metricTypeId, sourceRecordId, userId);
            if (!result || result === 'noquestions') {
                return this._finalizeExecution(execId, 'failed', 'Survey could not be generated: ' + result);
            }

            var instanceId = result.split(',')[0];
            var instanceGr = new GlideRecord('asmt_assessment_instance');
            if (instanceGr.get(instanceId)) {
                instanceGr.setValue('trigger_id', requestGr.getUniqueValue());
                instanceGr.setValue('trigger_table', this.REQUEST_TABLE);
                instanceGr.update();
            }

            return this._finalizeExecution(execId, 'success', 'Survey sent', instanceId);
        } catch (e) {
            return this._finalizeExecution(execId, 'failed', e.message);
        }
    },

    _finalizeExecution: function(execId, status, message, instanceId) {
        var F = this.F;
        var execGr = new GlideRecord(this.EXECUTION_TABLE);
        if (execGr.get(execId)) {
            execGr.setValue(F.status, status);
            execGr.setValue(F.message, message);
            execGr.setValue(F.executed_on, new GlideDateTime());
            if (instanceId)
                execGr.setValue(F.assessment_instance, instanceId);
            execGr.update();
        }
        return { status: status, message: message, assessment_instance: instanceId || '' };
    },

    processDueRequests: function() {
        var F = this.F;
        var processed = 0;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        requestGr.addQuery(F.active, true);
        requestGr.addQuery(F.state, 'active');
        requestGr.addQuery(F.next_run, '<=', new GlideDateTime());
        requestGr.query();

        while (requestGr.next()) {
            this.executeRequest(requestGr.getUniqueValue());
            processed++;
        }
        return processed;
    },

    getRequestSummary: function(requestId) {
        var F = this.F;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        if (!requestGr.get(requestId))
            return null;

        return {
            sys_id: requestGr.getUniqueValue(),
            number: requestGr.getValue(F.number),
            state: requestGr.getValue(F.state),
            company: requestGr[F.company].getDisplayValue(),
            metric_type: requestGr[F.metric_type].getDisplayValue(),
            recipient_mode: requestGr.getValue(F.recipient_mode),
            schedule_frequency: requestGr.getValue(F.schedule_frequency),
            next_run: requestGr.getValue(F.next_run),
            last_run: requestGr.getValue(F.last_run)
        };
    },

    type: 'CSATSurveyService'
};
