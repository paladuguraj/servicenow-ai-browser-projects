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

    COMPANY_ACTIVE_FIELD: 'u_active',
    ACCOUNT_TABLE: 'customer_account',
    ACCOUNT_PRIMARY_CONTACT_FIELD: 'primary_contact',
    ACCOUNT_PARENT_FIELD: 'account_parent',

    // Maps a white-label partner name to the domain that partner's customers
    // reach the portal on. Maintained by the business, shared with the
    // case-triggered survey invitation.
    WHITELABEL_PROPERTY: 'survey.link.whitelabel',

    // Page the invitation email points a recipient at.
    SURVEY_PAGE: 'csat?id=take_survey',

    // Surveys offered in the portal. Override without a deploy by setting the
    // csat.portal.survey_names property to a comma-separated list, or to an
    // empty string to offer every active survey.
    PORTAL_SURVEYS: ['Managed Network Services Survey - Manual', 'Managed Network Services Survey - Automatic'],

    // A recipient may not be surveyed again with the same survey until this
    // many days have passed since their last successful send of it. The window
    // is per survey, so a complex-resolution survey and the scheduled
    // relationship survey each run their own 90 days.
    COOLDOWN_DAYS: 90,

    // Recurring surveys land better midweek and mid-morning, so a scheduled
    // send waits for Tue/Wed/Thu between these hours in the recipient's local
    // time. Monday, Friday and the weekend are avoided. Sends the requester
    // triggers by hand are never held back.
    SEND_WINDOW_DAYS: [2, 3, 4], // GlideDateTime local day: 1 = Monday
    SEND_WINDOW_START_HOUR: 9,
    SEND_WINDOW_END_HOUR: 11,

    // These surveys are tied to a single case outcome, so they only make
    // sense sent immediately rather than on a recurring schedule.
    IMMEDIATE_ONLY_SURVEYS: ['Closed Case Survey', 'Managed Network Services Survey - Manual'],

    /**
     * The active flag and primary billing contact are customer-specific fields,
     * so check before querying them rather than returning nothing on an
     * instance that does not have them.
     */
    hasField: function(table, element) {
        if (!this._fieldCache)
            this._fieldCache = {};
        var key = table + '.' + element;
        if (this._fieldCache.hasOwnProperty(key))
            return this._fieldCache[key];

        var gr = new GlideRecord('sys_dictionary');
        gr.addQuery('name', table);
        gr.addQuery('element', element);
        gr.setLimit(1);
        gr.query();
        this._fieldCache[key] = gr.next() ? true : false;
        return this._fieldCache[key];
    },

    /**
     * White-label partners reach the portal on their own domain rather than on
     * the ServiceNow hostname. The survey.link.whitelabel property maps a
     * partner name to that domain, and a customer account inherits it from the
     * partner it sits under.
     *
     * Returns an empty string when the recipient is not behind a white-label
     * partner, when the property is absent or unparseable, or on an instance
     * without the customer account table — in every case the caller falls back
     * to the instance URL.
     */
    getWhitelabelDomain: function(companyId) {
        if (!companyId)
            return '';

        var raw = gs.getProperty(this.WHITELABEL_PROPERTY);
        if (!raw)
            return '';

        var domains;
        try {
            domains = JSON.parse(raw);
        } catch (e) {
            gs.warn('CSAT: ' + this.WHITELABEL_PROPERTY + ' is not valid JSON, so survey links will use the instance URL. ' + e.message);
            return '';
        }
        if (!domains)
            return '';

        if (!this.hasField(this.ACCOUNT_TABLE, this.ACCOUNT_PARENT_FIELD))
            return '';

        var account = new GlideRecord(this.ACCOUNT_TABLE);
        if (!account.get(companyId))
            return '';

        // The partner is normally the parent account. Accounts that are
        // themselves the partner, or that sit under a parent with no domain of
        // its own, are matched on their own name.
        var candidates = [account[this.ACCOUNT_PARENT_FIELD].name + '', account.getValue('name') + ''];
        for (var i = 0; i < candidates.length; i++) {
            var name = candidates[i];
            if (name && name !== 'null' && domains[name])
                return domains[name] + '';
        }

        return '';
    },

    /**
     * The link a recipient follows from the invitation email. Only the host
     * changes for a white-label partner; the survey page is the same for
     * everyone.
     */
    getSurveyLink: function(instanceId, companyId) {
        var host = this.getWhitelabelDomain(companyId) || gs.getProperty('glide.servlet.uri');
        return (host + '').replace(/\/+$/, '') + '/' + this.SURVEY_PAGE + '&instance_id=' + instanceId;
    },

    /**
     * Resolves the same link from the assessment instance alone, which is all
     * the invitation mail script has to work with.
     */
    getSurveyLinkForInstance: function(instanceGr) {
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        var companyId = requestGr.get(instanceGr.getValue('trigger_id')) ? requestGr.getValue(this.F.company) : '';
        return this.getSurveyLink(instanceGr.getUniqueValue(), companyId);
    },

    getCompanies: function(searchTerm, limit) {
        var companies = [];
        var gr = new GlideRecord('core_company');
        if (this.hasField('core_company', this.COMPANY_ACTIVE_FIELD))
            gr.addQuery(this.COMPANY_ACTIVE_FIELD, true);
        gr.addQuery('name', '!=', 'N/A');
        if (searchTerm)
            gr.addQuery('name', 'CONTAINS', searchTerm);
        gr.orderBy('name');
        gr.setLimit(limit ? parseInt(limit, 10) : 100);
        gr.query();
        while (gr.next()) {
            companies.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name')
            });
        }
        return companies;
    },

    /**
     * Names of the surveys the portal may offer. An empty list means no
     * restriction.
     */
    getPortalSurveyNames: function() {
        var override = gs.getProperty('csat.portal.survey_names');
        if (override === null || override === undefined)
            return this.PORTAL_SURVEYS;

        override = (override + '').trim();
        if (!override)
            return [];

        return override.split(',').map(function(name) {
            return name.trim();
        }).filter(function(name) {
            return name.length > 0;
        });
    },

    /**
     * The surveys the portal offers.
     *
     * The allow-list matches on name, which does not survive a survey being
     * renamed without the property following, or the two arriving separately
     * on another instance. That used to leave the form with an empty dropdown
     * and nothing to explain it, so a filter that matches nothing now falls
     * back to every active survey and says so. Offering too many is wrong but
     * obvious; offering none just looks broken.
     */
    getSurveyTemplates: function() {
        var allowed = this.getPortalSurveyNames();
        var templates = this._findSurveys(allowed);

        if (allowed.length && !templates.length) {
            gs.warn('CSAT: csat.portal.survey_names lists "' + allowed.join(', ') +
                '" but no active survey has those names, so every active survey is being offered. ' +
                'Align the property with the survey names on this instance.');

            templates = this._findSurveys([]);
            for (var i = 0; i < templates.length; i++)
                templates[i].outside_filter = true;
        }

        return templates;
    },

    _findSurveys: function(allowed) {
        var templates = [];
        var gr = new GlideRecord('asmt_metric_type');
        gr.addQuery('active', true);
        gr.addQuery('evaluation_method', 'survey');
        if (allowed.length)
            gr.addQuery('name', 'IN', allowed.join(','));
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            var name = gr.getValue('name');
            templates.push({
                sys_id: gr.getUniqueValue(),
                name: name,
                description: gr.getValue('description') || '',
                immediate_only: this.isImmediateOnly(name),
                // An unpublished survey cannot generate instances, so the
                // portal has to keep it out of reach rather than fail on send.
                published: gr.getValue('publish_state') === 'published',
                outside_filter: false
            });
        }
        return templates;
    },

    isPublished: function(metricTypeId) {
        var gr = new GlideRecord('asmt_metric_type');
        if (!gr.get(metricTypeId))
            return false;
        return gr.getValue('publish_state') === 'published';
    },

    isImmediateOnly: function(templateName) {
        return this.IMMEDIATE_ONLY_SURVEYS.indexOf(String(templateName)) !== -1;
    },

    isImmediateOnlyById: function(metricTypeId) {
        if (!metricTypeId)
            return false;
        var gr = new GlideRecord('asmt_metric_type');
        if (!gr.get(metricTypeId))
            return false;
        return this.isImmediateOnly(gr.getValue('name'));
    },

    /**
     * Reads the account's Primary Contact. customer_contact extends sys_user,
     * so the reference resolves straight to a surveyable recipient.
     */
    getPrimaryContact: function(companyId, metricTypeId) {
        var result = { email: '', user: null, eligible: false, reason: '' };
        if (!companyId)
            return result;

        if (!this.hasField(this.ACCOUNT_TABLE, this.ACCOUNT_PRIMARY_CONTACT_FIELD)) {
            result.reason = 'Primary Contact is not configured on the account table.';
            return result;
        }

        var accountGr = new GlideRecord(this.ACCOUNT_TABLE);
        if (!accountGr.get(companyId)) {
            result.reason = 'This company has no Account Primary Contact';
            return result;
        }

        var contactId = accountGr.getValue(this.ACCOUNT_PRIMARY_CONTACT_FIELD);
        if (!contactId) {
            result.reason = 'This company has no Account Primary Contact';
            return result;
        }

        var userGr = new GlideRecord('sys_user');
        if (!userGr.get(contactId)) {
            result.reason = 'The Account Primary Contact record could not be found.';
            return result;
        }

        result.email = userGr.getValue('email') || '';
        result.user = {
            sys_id: userGr.getUniqueValue(),
            name: userGr.getValue('name'),
            user_name: userGr.getValue('user_name'),
            email: userGr.getValue('email')
        };

        var portal = this.checkPortalAccount(userGr);
        if (!portal.active) {
            result.reason = portal.reason;
            return result;
        }

        var cooldown = this.getCooldown(result.user.sys_id, metricTypeId);
        if (cooldown.blocked) {
            result.reason = cooldown.reason;
            result.cooldown = cooldown;
            return result;
        }

        result.eligible = true;
        return result;
    },

    /**
     * "Active portal account" means the user can actually sign in and answer
     * the survey: enabled, not locked out, and not an API-only account.
     */
    checkPortalAccount: function(userGr) {
        if (userGr.getValue('active') != '1' && userGr.getValue('active') !== 'true')
            return { active: false, reason: userGr.getValue('name') + ' does not have an active account.' };
        if (userGr.getValue('locked_out') == '1' || userGr.getValue('locked_out') === 'true')
            return { active: false, reason: userGr.getValue('name') + ' is locked out.' };
        if (userGr.getValue('web_service_access_only') == '1' || userGr.getValue('web_service_access_only') === 'true')
            return { active: false, reason: userGr.getValue('name') + ' is a web-service-only account and cannot use the portal.' };
        if (userGr.getValue('internal_integration_user') == '1' || userGr.getValue('internal_integration_user') === 'true')
            return { active: false, reason: userGr.getValue('name') + ' is an integration account and cannot use the portal.' };
        if (!userGr.getValue('email'))
            return { active: false, reason: userGr.getValue('name') + ' has no email address.' };
        return { active: true, reason: '' };
    },

    /**
     * Returns how much of the cooldown window is left for a recipient.
     */
    /**
     * The 90-day window runs per survey rather than across the portal, so a
     * recipient can be asked about a complex resolution and still receive the
     * scheduled relationship survey. Passing no metric type falls back to the
     * old portal-wide behaviour, which is what the reporting probes rely on.
     */
    getCooldown: function(userId, metricTypeId) {
        var F = this.F;
        var result = { blocked: false, last_sent: '', days_remaining: 0, reason: '', metric_type: metricTypeId || '' };

        var cutoff = new GlideDateTime();
        cutoff.addDaysUTC(-this.COOLDOWN_DAYS);

        var gr = new GlideRecord(this.EXECUTION_TABLE);
        gr.addQuery(F.user, userId);
        gr.addQuery(F.status, 'success');
        gr.addQuery(F.executed_on, '>=', cutoff);
        if (metricTypeId)
            gr.addQuery(F.metric_type, metricTypeId);
        gr.orderByDesc(F.executed_on);
        gr.setLimit(1);
        gr.query();

        if (!gr.next())
            return result;

        var lastSent = new GlideDateTime(gr.getValue(F.executed_on));
        var eligibleFrom = new GlideDateTime(lastSent);
        eligibleFrom.addDaysUTC(this.COOLDOWN_DAYS);

        var remaining = Math.ceil(
            GlideDateTime.subtract(new GlideDateTime(), eligibleFrom).getNumericValue() / (1000 * 60 * 60 * 24)
        );

        result.blocked = true;
        result.last_sent = lastSent.getDisplayValue();
        result.days_remaining = remaining > 0 ? remaining : 1;
        result.reason =
            'Surveyed on ' + result.last_sent + '. Eligible again in ' + result.days_remaining + ' day(s).';
        return result;
    },

    getUsersByCompany: function(companyId, metricTypeId) {
        var users = [];
        if (!companyId)
            return users;

        var gr = new GlideRecord('sys_user');
        gr.addQuery('active', true);
        gr.addQuery('company', companyId);
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            var portal = this.checkPortalAccount(gr);
            var cooldown = this.getCooldown(gr.getUniqueValue(), metricTypeId);
            users.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                user_name: gr.getValue('user_name'),
                email: gr.getValue('email'),
                eligible: portal.active && !cooldown.blocked,
                reason: !portal.active ? portal.reason : cooldown.reason
            });
        }
        return users;
    },

    createSurveyRequest: function(payload) {
        var F = this.F;
        var mode = payload.recipient_mode || 'primary_user';

        if (!this.isPublished(payload.metric_type)) {
            var tplGr = new GlideRecord('asmt_metric_type');
            var tplName = tplGr.get(payload.metric_type) ? tplGr.getValue('name') : 'The selected survey';
            return { error: 'Survey "' + tplName + '" is still in Draft. Publish it in Survey Designer before sending.' };
        }

        // Case-outcome surveys cannot be scheduled, regardless of what the
        // client sent.
        var frequency = payload.schedule_frequency || 'immediate';
        if (this.isImmediateOnlyById(payload.metric_type))
            frequency = 'immediate';

        // Recipients are chosen with checkboxes, so a request can go to the
        // account's primary contact, to named users, or to both at once.
        var recipients = [];
        if (mode === 'primary_user' || mode === 'both') {
            var primary = this.getPrimaryContact(payload.company, payload.metric_type);
            if (!primary.eligible && mode === 'primary_user')
                return { error: primary.reason || 'The primary user cannot be surveyed.' };
            if (primary.eligible)
                recipients.push(primary.user.sys_id);
        }
        if (mode === 'selected_users' || mode === 'both') {
            var chosen = payload.selected_users || [];
            for (var r = 0; r < chosen.length; r++) {
                if (chosen[r] && recipients.indexOf(chosen[r]) === -1)
                    recipients.push(chosen[r]);
            }
        }
        if (!recipients.length)
            return { error: 'No eligible recipients were selected.' };
        payload.selected_users = recipients;

        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        requestGr.initialize();
        requestGr.setValue(F.company, payload.company);
        requestGr.setValue(F.metric_type, payload.metric_type);
        requestGr.setValue(F.recipient_mode, mode);
        requestGr.setValue(F.schedule_frequency, frequency);
        requestGr.setValue(F.notes, payload.notes || '');
        requestGr.setValue(F.requested_by, gs.getUserID());
        requestGr.setValue(F.state, 'draft');
        requestGr.setValue(F.active, true);

        if (frequency === 'immediate') {
            requestGr.setValue(F.next_run, new GlideDateTime());
        }

        var requestId = requestGr.insert();
        if (!requestId)
            throw new Error('Failed to create survey request record');

        if (payload.selected_users) {
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

    /**
     * The timezone the send window is judged in. Most user records have no
     * timezone set, so in practice this is usually the instance default; the
     * recipient's own is used whenever it is populated.
     */
    sendWindowTimeZone: function(requestGr) {
        var recipients = this.getRecipients(requestGr);
        for (var i = 0; i < recipients.length; i++) {
            var userGr = new GlideRecord('sys_user');
            if (userGr.get(recipients[i])) {
                var tz = (userGr.getValue('time_zone') || '').trim();
                if (tz) return tz;
            }
        }
        return gs.getProperty('glide.sys.default.tz') || 'UTC';
    },

    isWithinSendWindow: function(when, timeZone) {
        var gdt = new GlideDateTime(when);
        gdt.setTZ(Packages.java.util.TimeZone.getTimeZone(timeZone));

        var day = parseInt(gdt.getDayOfWeekLocalTime(), 10);
        if (this.SEND_WINDOW_DAYS.indexOf(day) === -1)
            return false;

        var hour = parseInt(gdt.getLocalTime().getByFormat('HH'), 10);
        return hour >= this.SEND_WINDOW_START_HOUR && hour < this.SEND_WINDOW_END_HOUR;
    },

    /**
     * The first moment from `when` onwards that falls inside the window.
     * Returns `when` unchanged if it already does. Steps by the hour, which is
     * the resolution the scheduled job runs at.
     */
    nextSendWindow: function(when, timeZone) {
        var candidate = new GlideDateTime(when);
        // A whole week of hours is more than enough to reach Tue/Wed/Thu.
        for (var i = 0; i < 24 * 8; i++) {
            if (this.isWithinSendWindow(candidate, timeZone))
                return candidate;
            candidate = new GlideDateTime(candidate);
            candidate.addSeconds(3600);
        }
        return new GlideDateTime(when);
    },

    /**
     * Recurring sends are held to the window; immediate ones are not, because
     * the requester is asking for them to go now.
     */
    scheduleNextRun: function(requestGr, from) {
        if (requestGr.getValue(this.F.schedule_frequency) === 'immediate')
            return from;
        return this.nextSendWindow(from, this.sendWindowTimeZone(requestGr));
    },

    activateRequest: function(requestId) {
        var F = this.F;
        var requestGr = new GlideRecord(this.REQUEST_TABLE);
        if (!requestGr.get(requestId))
            throw new Error('Survey request not found');

        requestGr.setValue(F.state, 'active');
        if (!requestGr.getValue(F.next_run)) {
            requestGr.setValue(F.next_run, this.scheduleNextRun(requestGr, new GlideDateTime()));
        }
        requestGr.update();

        if (requestGr.getValue(F.schedule_frequency) === 'immediate') {
            this.executeRequest(requestId);
        }
    },

    /**
     * Both recipient modes resolve to explicit rows in the request-user table,
     * so a request can never fan out to an entire company by accident.
     */
    getRecipients: function(requestGr) {
        var F = this.F;
        var recipients = [];

        var rel = new GlideRecord(this.REQUEST_USER_TABLE);
        rel.addQuery(F.survey_request, requestGr.getUniqueValue());
        rel.query();
        while (rel.next()) {
            recipients.push(rel.getValue(F.user));
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
            var result = this._sendSurveyToUser(requestGr, metricTypeId, userId);
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
        if (frequency === 'every_30_days' || frequency === 'every_60_days') {
            var next = new GlideDateTime();
            next.addDaysUTC(frequency === 'every_30_days' ? 30 : 60);
            requestGr.setValue(F.next_run, this.scheduleNextRun(requestGr, next));
            requestGr.setValue(F.state, 'active');
        } else {
            requestGr.setValue(F.state, 'completed');
            requestGr.setValue(F.next_run, '');
        }

        requestGr.update();

        return { executed: executed, skipped: skipped, failed: failed };
    },

    _sendSurveyToUser: function(requestGr, metricTypeId, userId) {
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

            var portal = this.checkPortalAccount(userGr);
            if (!portal.active) {
                return this._finalizeExecution(execId, 'skipped', portal.reason);
            }

            // Enforced here as well as in the UI so scheduled runs and API
            // callers cannot bypass the cooldown. Scoped to the survey being
            // sent, so each survey carries its own 90-day window.
            var cooldown = this.getCooldown(userId, metricTypeId);
            if (cooldown.blocked) {
                return this._finalizeExecution(execId, 'skipped', cooldown.reason);
            }

            // An empty source record is required: survey question conditions are
            // evaluated against the metric type's own table, so passing the CSAT
            // request sys_id here makes the platform return 'noquestions'.
            var result = String(new SNC.AssessmentCreation().createAssessments(metricTypeId, '', userId) || '');
            var instanceId = result.split(',')[0];

            // The API signals problems by returning a word rather than a sys_id
            // ('noquestions', 'not_available', ...), so treat anything that is
            // not a real, retrievable instance as a failure.
            if (!/^[0-9a-f]{32}$/.test(instanceId)) {
                return this._finalizeExecution(execId, 'failed', this._explainCreateFailure(result, metricTypeId));
            }

            var instanceGr = new GlideRecord('asmt_assessment_instance');
            if (!instanceGr.get(instanceId)) {
                return this._finalizeExecution(execId, 'failed', 'Survey instance ' + instanceId + ' could not be retrieved after creation.');
            }

            instanceGr.setValue('trigger_id', requestGr.getUniqueValue());
            instanceGr.setValue('trigger_table', this.REQUEST_TABLE);
            instanceGr.update();
            new CSATSurveyNotification().notifyAssigned(instanceGr);

            return this._finalizeExecution(execId, 'success', 'Survey sent', instanceId);
        } catch (e) {
            return this._finalizeExecution(execId, 'failed', e.message);
        }
    },

    /**
     * Turns the platform's terse return codes into something a portal user can
     * act on.
     */
    _explainCreateFailure: function(result, metricTypeId) {
        var name = '';
        var published = true;
        var gr = new GlideRecord('asmt_metric_type');
        if (gr.get(metricTypeId)) {
            name = gr.getValue('name');
            published = gr.getValue('publish_state') === 'published';
        }

        if (result === 'not_available') {
            if (!published)
                return 'Survey "' + name + '" is still in Draft. Publish it before sending.';
            return 'Survey "' + name + '" is not available for this user. It may already be assigned to them and not allow retakes.';
        }

        if (result === 'noquestions')
            return 'Survey "' + name + '" has no questions that apply, so nothing could be generated.';

        return 'Survey could not be generated (' + (result || 'no response') + ').';
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

        var deferred = 0;
        while (requestGr.next()) {
            // A request can come due outside the window when it was scheduled
            // before this rule existed, or when the job was held up. Push it to
            // the next good slot rather than sending at a bad time.
            if (requestGr.getValue(F.schedule_frequency) !== 'immediate') {
                var zone = this.sendWindowTimeZone(requestGr);
                if (!this.isWithinSendWindow(new GlideDateTime(), zone)) {
                    var slot = this.nextSendWindow(new GlideDateTime(), zone);
                    var holdGr = new GlideRecord(this.REQUEST_TABLE);
                    if (holdGr.get(requestGr.getUniqueValue())) {
                        holdGr.setValue(F.next_run, slot);
                        holdGr.update();
                    }
                    deferred++;
                    continue;
                }
            }
            this.executeRequest(requestGr.getUniqueValue());
            processed++;
        }
        if (deferred)
            gs.info('CSAT: ' + deferred + ' scheduled request(s) held until the next Tue-Thu mid-morning slot.');
        return processed;
    },

    getExecutionStats: function(requestId) {
        var F = this.F;
        var stats = { total: 0, success: 0, failed: 0, skipped: 0, pending: 0, first_error: '', recipients: [] };

        var execGr = new GlideRecord(this.EXECUTION_TABLE);
        execGr.addQuery(F.survey_request, requestId);
        execGr.query();
        while (execGr.next()) {
            var status = execGr.getValue(F.status);
            stats.total++;
            if (stats.hasOwnProperty(status))
                stats[status]++;
            if (status !== 'success' && !stats.first_error)
                stats.first_error = execGr.getValue(F.message) || '';
            stats.recipients.push({
                name: execGr[F.user].getDisplayValue(),
                status: status,
                message: execGr.getValue(F.message) || ''
            });
        }
        return stats;
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
            last_run: requestGr.getValue(F.last_run),
            executions: this.getExecutionStats(requestId)
        };
    },

    type: 'CSATSurveyService'
};
