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
     * The same filters expressed as an encoded query, so exports can reuse
     * ServiceNow's own list exporter rather than reimplementing the selection.
     */
    buildEncodedQuery: function(filters) {
        filters = filters || {};
        var parts = ['u_status=success'];

        if (filters.metric_type) parts.push('u_metric_type=' + filters.metric_type);
        if (filters.company) parts.push('u_survey_request.u_company=' + filters.company);
        if (filters.sent_from) parts.push('u_executed_on>=' + filters.sent_from + ' 00:00:00');
        if (filters.sent_to) parts.push('u_executed_on<=' + filters.sent_to + ' 23:59:59');
        if (filters.response === 'replied') parts.push('u_assessment_instance.state=complete');
        // A send with no instance at all still counts as awaiting a reply, and a
        // dot-walked != would drop those rows on its own.
        if (filters.response === 'not_replied')
            parts.push('u_assessment_instance.state!=complete', 'ORu_assessment_instanceISEMPTY');

        parts.push('ORDERBYDESCu_executed_on');
        return parts.join('^');
    },

    EXPORT_FIELDS: [
        'u_survey_request.u_company',
        'u_metric_type',
        'u_user',
        'u_user.email',
        'u_executed_on',
        'u_assessment_instance.state',
        'u_assessment_instance.taken_on'
    ],

    /**
     * A link to the platform's XLSX exporter. This produces a genuine
     * spreadsheet and applies the caller's own read access, unlike a file
     * assembled in the browser.
     */
    getExcelUrl: function(filters) {
        return '/' + this.EXECUTION_TABLE + '.do?XLSX' +
            '&sysparm_query=' + encodeURIComponent(this.buildEncodedQuery(filters)) +
            '&sysparm_fields=' + encodeURIComponent(this.EXPORT_FIELDS.join(','));
    },

    /**
     * Renders the current results to a PDF and attaches it to the requesting
     * user, which keeps each person's exports private and easy to purge.
     * Returns the attachment sys_id for the client to download.
     */
    generatePdf: function(filters) {
        var results = this.getResults(filters);
        var breakdown = this._breakdownFromRows(results.rows);
        var userId = gs.getUserID();

        this._purgePreviousExports(userId);

        var html = this._buildPdfHtml(filters, results, breakdown);
        var name = 'csat-survey-results-' + new GlideDateTime().getLocalDate().getValue();

        try {
            new sn_pdfgeneratorutils.PDFGenerationAPI().convertToPDF(html, 'sys_user', userId, name);
        } catch (e) {
            return { error: 'PDF could not be generated: ' + e.message };
        }

        var att = new GlideRecord('sys_attachment');
        att.addQuery('table_name', 'sys_user');
        att.addQuery('table_sys_id', userId);
        att.addQuery('file_name', 'STARTSWITH', 'csat-survey-results');
        att.orderByDesc('sys_created_on');
        att.setLimit(1);
        att.query();

        if (!att.next())
            return { error: 'PDF was generated but the file could not be located.' };

        // The attachment REST endpoint is used rather than sys_attachment.do,
        // which bounces to navpage.do instead of serving the file.
        return {
            sys_id: att.getUniqueValue(),
            file_name: att.getValue('file_name'),
            url: '/api/now/attachment/' + att.getUniqueValue() + '/file'
        };
    },

    _purgePreviousExports: function(userId) {
        var att = new GlideRecord('sys_attachment');
        att.addQuery('table_name', 'sys_user');
        att.addQuery('table_sys_id', userId);
        att.addQuery('file_name', 'STARTSWITH', 'csat-survey-results');
        att.query();
        while (att.next())
            att.deleteRecord();
    },

    _buildPdfHtml: function(filters, results, breakdown) {
        var s = results.summary;
        var esc = function(v) {
            return GlideStringUtil.escapeHTML(v === null || v === undefined ? '' : String(v));
        };

        var applied = [];
        if (filters.metric_type) applied.push('Survey: ' + esc(this._displayName('asmt_metric_type', filters.metric_type)));
        if (filters.company) applied.push('Account: ' + esc(this._displayName('core_company', filters.company)));
        if (filters.sent_from) applied.push('Sent from: ' + esc(filters.sent_from));
        if (filters.sent_to) applied.push('Sent to: ' + esc(filters.sent_to));
        if (filters.response && filters.response !== 'all')
            applied.push('Showing: ' + (filters.response === 'replied' ? 'replied only' : 'awaiting reply only'));
        if (!applied.length) applied.push('No filters applied');

        var html = [];
        html.push('<html><head><meta charset="utf-8"/><style>');
        html.push('body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#25313d;}');
        html.push('h1{font-size:18px;margin:0 0 4px;} h2{font-size:13px;margin:18px 0 6px;}');
        html.push('.meta{color:#6b7580;font-size:10px;margin-bottom:14px;}');
        html.push('table{border-collapse:collapse;width:100%;margin-bottom:12px;}');
        html.push('th,td{border:1px solid #c8d1da;padding:4px 6px;text-align:left;vertical-align:top;}');
        html.push('th{background:#eef2f6;}');
        html.push('.tiles td{text-align:center;font-size:16px;font-weight:bold;border:1px solid #c8d1da;}');
        html.push('.tiles th{text-align:center;font-weight:normal;font-size:10px;color:#6b7580;}');
        html.push('</style></head><body>');

        html.push('<h1>CSAT Survey Results</h1>');
        html.push('<div class="meta">' + applied.join(' &nbsp;|&nbsp; ') +
            '<br/>Generated ' + esc(new GlideDateTime().getDisplayValue()) + ' by ' + esc(gs.getUserDisplayName()) + '</div>');

        html.push('<table class="tiles"><tr><th>Surveys sent</th><th>Replied</th><th>Response rate</th><th>Average score</th></tr>');
        html.push('<tr><td>' + s.sent + '</td><td>' + s.replied + '</td><td>' + s.response_rate +
            '%</td><td>' + (s.average_score === null ? '-' : s.average_score) + '</td></tr></table>');

        if (s.skipped || s.failed)
            html.push('<div class="meta">Excluded from the totals: ' + s.skipped + ' skipped and ' +
                s.failed + ' failed send(s), which never reached a recipient.</div>');

        html.push('<h2>By account</h2><table><tr><th>Account</th><th>Sent</th><th>Replied</th><th>Rate</th></tr>');
        breakdown.by_account.forEach(function(a) {
            html.push('<tr><td>' + esc(a.name) + '</td><td>' + a.sent + '</td><td>' + a.replied + '</td><td>' + a.response_rate + '%</td></tr>');
        });
        html.push('</table>');

        html.push('<h2>By survey</h2><table><tr><th>Survey</th><th>Sent</th><th>Replied</th><th>Rate</th></tr>');
        breakdown.by_survey.forEach(function(b) {
            html.push('<tr><td>' + esc(b.name) + '</td><td>' + b.sent + '</td><td>' + b.replied + '</td><td>' + b.response_rate + '%</td></tr>');
        });
        html.push('</table>');

        html.push('<h2>Detail (' + results.rows.length + ' row' + (results.rows.length === 1 ? '' : 's') + ')</h2>');
        html.push('<table><tr><th>Account</th><th>Survey</th><th>Recipient</th><th>Sent on</th><th>Status</th><th>Replied on</th><th>Score</th><th>Comments</th></tr>');
        results.rows.forEach(function(r) {
            html.push('<tr><td>' + esc(r.account) + '</td><td>' + esc(r.survey) + '</td><td>' + esc(r.recipient) +
                '</td><td>' + esc(r.sent_on) + '</td><td>' + (r.replied ? 'Replied' : 'Awaiting') +
                '</td><td>' + esc(r.replied_on) + '</td><td>' + (r.score === null ? '' : r.score) +
                '</td><td>' + esc(r.comments) + '</td></tr>');
        });
        html.push('</table>');

        if (results.truncated)
            html.push('<div class="meta">Only the first ' + results.max_rows + ' rows are included.</div>');

        html.push('</body></html>');
        return html.join('');
    },

    _displayName: function(table, sysId) {
        var gr = new GlideRecord(table);
        return gr.get(sysId) ? gr.getDisplayValue() : sysId;
    },

    /**
     * Counts by account and by survey for the summary tiles.
     */
    getBreakdown: function(filters) {
        return this._breakdownFromRows(this.getResults(filters).rows);
    },

    _breakdownFromRows: function(rows) {
        var results = { rows: rows };
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
