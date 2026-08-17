var CSATSurveyReport = Class.create();
CSATSurveyReport.prototype = {
    initialize: function() {},

    EXECUTION_TABLE: 'u_x_csat_survey_execution',
    REQUEST_TABLE: 'u_x_csat_survey_request',

    // Reporting reads a joined view of execution -> request -> assessment
    // instance, so a row can be filtered by account and by whether the
    // recipient has replied without denormalising anything onto the audit
    // table.
    MAX_ROWS: 1000,

    /**
     * Only surveys and accounts that actually appear in the audit trail are
     * offered, so the filters cannot produce an empty report by selecting
     * something that was never sent.
     *
     * The survey list is additionally limited to the ones the portal is
     * configured to send, so retired or externally triggered surveys do not
     * appear as filter options. Both this and the request form read the same
     * csat.portal.survey_names property.
     */
    getFilterOptions: function() {
        var surveys = {};
        var accounts = {};
        var allowed = new CSATSurveyService().getPortalSurveyNames();

        var gr = new GlideRecord(this.EXECUTION_TABLE);
        gr.addQuery('u_status', 'success');
        gr.orderByDesc('u_executed_on');
        gr.setLimit(5000);
        gr.query();

        while (gr.next()) {
            var typeId = gr.getValue('u_metric_type');
            var typeName = gr.u_metric_type.getDisplayValue();
            var offered = !allowed.length || allowed.indexOf(typeName + '') !== -1;
            if (typeId && offered && !surveys[typeId])
                surveys[typeId] = typeName;

            var companyId = gr.u_survey_request.u_company + '';
            if (companyId && companyId !== 'null' && !accounts[companyId])
                accounts[companyId] = gr.u_survey_request.u_company.getDisplayValue();
        }

        return {
            surveys: this._toSortedList(surveys),
            accounts: this._toSortedList(accounts)
        };
    },

    _toSortedList: function(map) {
        var list = [];
        for (var id in map) {
            if (map.hasOwnProperty(id))
                list.push({ sys_id: id, name: map[id] });
        }
        list.sort(function(a, b) {
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return list;
    },

    /**
     * filters: metric_type, company, sent_from, sent_to, response
     *          (response: all | replied | not_replied)
     */
    getResults: function(filters) {
        filters = filters || {};

        var summary = {
            sent: 0,
            replied: 0,
            not_replied: 0,
            response_rate: 0,
            skipped: 0,
            failed: 0,
            score_count: 0,
            score_total: 0,
            average_score: null
        };
        var rows = [];
        var truncated = false;

        var gr = new GlideRecord(this.EXECUTION_TABLE);
        if (filters.metric_type) gr.addQuery('u_metric_type', filters.metric_type);
        if (filters.company) gr.addQuery('u_survey_request.u_company', filters.company);
        if (filters.sent_from) gr.addQuery('u_executed_on', '>=', filters.sent_from + ' 00:00:00');
        if (filters.sent_to) gr.addQuery('u_executed_on', '<=', filters.sent_to + ' 23:59:59');
        gr.orderByDesc('u_executed_on');
        gr.query();

        while (gr.next()) {
            var status = gr.getValue('u_status');

            // Skipped and failed never reached anyone, so they are counted for
            // transparency but are not part of the sent/replied ratio.
            if (status === 'skipped') { summary.skipped++; continue; }
            if (status !== 'success') { summary.failed++; continue; }

            var instanceId = gr.getValue('u_assessment_instance');
            var response = this._readResponse(instanceId);

            if (filters.response === 'replied' && !response.replied) continue;
            if (filters.response === 'not_replied' && response.replied) continue;

            summary.sent++;
            if (response.replied) {
                summary.replied++;
                if (response.score !== null) {
                    summary.score_count++;
                    summary.score_total += response.score;
                }
            } else {
                summary.not_replied++;
            }

            if (rows.length < this.MAX_ROWS) {
                rows.push({
                    account: gr.u_survey_request.u_company.getDisplayValue(),
                    survey: gr.u_metric_type.getDisplayValue(),
                    recipient: gr.u_user.getDisplayValue(),
                    email: gr.u_user.email + '',
                    sent_on: gr.getDisplayValue('u_executed_on'),
                    replied: response.replied,
                    replied_on: response.taken_on,
                    score: response.score,
                    comments: response.comments,
                    request: gr.getValue('u_survey_request')
                });
            } else {
                truncated = true;
            }
        }

        if (summary.sent > 0)
            summary.response_rate = Math.round((summary.replied / summary.sent) * 1000) / 10;
        if (summary.score_count > 0)
            summary.average_score = Math.round((summary.score_total / summary.score_count) * 100) / 100;

        return { summary: summary, rows: rows, truncated: truncated, max_rows: this.MAX_ROWS };
    },

    /**
     * A reply is an assessment instance that reached "complete". The rating and
     * any free text are read from the answered questions.
     */
    _readResponse: function(instanceId) {
        var result = { replied: false, taken_on: '', score: null, comments: '' };
        if (!instanceId)
            return result;

        var instance = new GlideRecord('asmt_assessment_instance');
        if (!instance.get(instanceId))
            return result;

        if (instance.getValue('state') !== 'complete')
            return result;

        result.replied = true;
        result.taken_on = instance.getDisplayValue('taken_on');

        var answers = new GlideRecord('asmt_assessment_instance_question');
        answers.addQuery('instance', instanceId);
        answers.query();
        while (answers.next()) {
            var text = (answers.getValue('string_value') || '').trim();
            if (text) {
                result.comments = result.comments ? result.comments + ' | ' + text : text;
                continue;
            }
            var value = answers.getValue('value');
            if (value !== null && value !== '' && result.score === null)
                result.score = parseFloat(value);
        }

        return result;
    },

    /**
     * Counts by account and by survey for the summary tiles.
     */
    getBreakdown: function(filters) {
        var results = this.getResults(filters);
        var byAccount = {};
        var bySurvey = {};

        results.rows.forEach(function(row) {
            [[byAccount, row.account], [bySurvey, row.survey]].forEach(function(pair) {
                var bucket = pair[0];
                var key = pair[1] || '(none)';
                if (!bucket[key]) bucket[key] = { name: key, sent: 0, replied: 0 };
                bucket[key].sent++;
                if (row.replied) bucket[key].replied++;
            });
        });

        function toList(bucket) {
            var list = [];
            for (var k in bucket) {
                if (bucket.hasOwnProperty(k)) {
                    var entry = bucket[k];
                    entry.response_rate = entry.sent ? Math.round((entry.replied / entry.sent) * 1000) / 10 : 0;
                    list.push(entry);
                }
            }
            list.sort(function(a, b) { return b.sent - a.sent; });
            return list;
        }

        return { by_account: toList(byAccount), by_survey: toList(bySurvey) };
    },

    type: 'CSATSurveyReport'
};
