var CSATDashboard = Class.create();
CSATDashboard.prototype = {
    initialize: function() {},

    // Each option is a fixed slice of asmt_assessment_instance, told apart by
    // what raised the survey: closed cases, or CSAT Survey Requests (which
    // covers both the Manual and the Schedule survey). A program with a
    // surveysProperty offers only the surveys named there in its Survey filter.
    PROGRAMS: [
        {
            id: 'case',
            label: 'Case Auto CSAT',
            triggerTable: 'sn_customerservice_case',
            surveysProperty: 'csat.dashboard.case_surveys',
            defaultSurveys: 'Closed Case Survey'
        },
        { id: 'csat', label: 'CSAT Manual Tool', triggerTable: 'u_x_csat_survey_request' }
    ],

    RANGES: [
        { id: '30d', label: 'Last 30 days' },
        { id: '90d', label: 'Last 90 days' },
        { id: '12m', label: 'Last 12 months' },
        { id: 'ytd', label: 'Year to date' },
        { id: 'all', label: 'All time' },
        { id: 'custom', label: 'Custom dates' }
    ],

    RATING_TYPES: 'scale,numericscale,boolean,choice',
    RECENT_LIMIT: 25,
    COMMENT_LIMIT: 20,
    EXPORT_LIMIT: 10000,
    PDF_RESPONSE_LIMIT: 500,
    PDF_PREFIX: 'csat-survey-dashboard',
    // asmt_metric_result stores a skipped question with actual_value "-1".
    UNANSWERED: '-1',

    getOptions: function() {
        return { programs: this.PROGRAMS, ranges: this.RANGES };
    },

    _context: function(params) {
        params = params || {};
        var program = this._program(params.program);
        var range = this._range(params.range, params.from, params.to);
        var surveys = this._surveyOptions(program);
        var survey = '';
        for (var i = 0; i < surveys.length; i++) {
            if (surveys[i].sys_id == params.survey)
                survey = params.survey;
        }
        // A program limited to named surveys counts only those, even under
        // "All surveys".
        var surveyIds = survey ? [survey] : [];
        if (!survey && program.surveysProperty)
            surveyIds = surveys.length ? surveys.map(function(s) { return s.sys_id; }) : ['-1'];
        var conditions = this._conditions(program, range, surveyIds);
        return {
            program: program,
            range: range,
            surveys: surveys,
            survey: survey,
            conditions: conditions,
            encoded: conditions.join('^')
        };
    },

    getDashboard: function(params) {
        var ctx = this._context(params);
        var program = ctx.program;
        var range = ctx.range;
        var conditions = ctx.conditions;
        var encoded = ctx.encoded;

        var states = this._countBy(encoded, 'state');
        var summary = this._summary(states);

        return {
            program: program,
            range: range,
            survey: ctx.survey,
            surveyName: this._surveyName(ctx),
            surveys: ctx.surveys,
            summary: summary,
            states: this._stateBars(states),
            trend: this._trend(encoded, range),
            bySurvey: this._bySurvey(encoded),
            questions: this._questions(conditions),
            comments: this._comments(conditions),
            recent: this._recent(encoded, program),
            links: {
                sent: '/asmt_assessment_instance_list.do?sysparm_query=' + encodeURIComponent(encoded + '^ORDERBYDESCsys_created_on'),
                responses: '/asmt_assessment_instance_list.do?sysparm_query=' + encodeURIComponent(encoded + '^state=complete^ORDERBYDESCtaken_on'),
                results: '/asmt_metric_result_list.do?sysparm_query=' + encodeURIComponent(this._prefixed(conditions).join('^') + '^ORDERBYDESCsys_created_on')
            }
        };
    },

    _program: function(id) {
        for (var i = 0; i < this.PROGRAMS.length; i++) {
            if (this.PROGRAMS[i].id == id)
                return this.PROGRAMS[i];
        }
        return this.PROGRAMS[0];
    },

    /**
     * Dates are whole days in the viewer's time zone. "All time" has no bounds
     * and is bucketed by year; anything up to two years is bucketed by month.
     */
    _range: function(id, from, to) {
        var valid = /^\d{4}-\d{2}-\d{2}$/;
        var today = new GlideDateTime().getLocalDate().getValue();
        var range = { id: id || '12m', from: '', to: today, bucket: 'Month' };

        var start = new GlideDateTime();
        if (range.id == '30d') {
            start.addDaysLocalTime(-29);
            range.from = start.getLocalDate().getValue();
        } else if (range.id == '90d') {
            start.addDaysLocalTime(-89);
            range.from = start.getLocalDate().getValue();
        } else if (range.id == 'ytd') {
            range.from = today.substring(0, 4) + '-01-01';
        } else if (range.id == 'all') {
            range.to = '';
            range.bucket = 'Year';
        } else if (range.id == 'custom' && valid.test(from || '') && valid.test(to || '') && from <= to) {
            range.from = from;
            range.to = to;
        } else {
            range.id = '12m';
            start.addMonthsLocalTime(-11);
            range.from = start.getLocalDate().getValue().substring(0, 8) + '01';
        }

        if (range.from && range.to && this._monthIndex(range.to) - this._monthIndex(range.from) > 24)
            range.bucket = 'Year';
        return range;
    },

    _conditions: function(program, range, surveyIds) {
        var parts = ['trigger_table=' + program.triggerTable];
        if (range.from)
            parts.push("sys_created_on>=javascript:gs.dateGenerate('" + range.from + "','start')");
        if (range.to)
            parts.push("sys_created_on<=javascript:gs.dateGenerate('" + range.to + "','end')");
        if (surveyIds.length == 1)
            parts.push('metric_type=' + surveyIds[0]);
        else if (surveyIds.length)
            parts.push('metric_typeIN' + surveyIds.join(','));
        return parts;
    },

    // The same conditions applied to asmt_metric_result through its instance.
    _prefixed: function(conditions) {
        return conditions.map(function(part) { return 'instance.' + part; });
    },

    _countBy: function(encoded, field) {
        var counts = {};
        var ga = new GlideAggregate('asmt_assessment_instance');
        ga.addEncodedQuery(encoded);
        ga.addAggregate('COUNT');
        ga.groupBy(field);
        ga.query();
        while (ga.next())
            counts[ga.getValue(field) || ''] = parseInt(ga.getAggregate('COUNT'), 10);
        return counts;
    },

    _summary: function(states) {
        var sent = 0;
        for (var s in states)
            sent += states[s];
        var responded = states.complete || 0;
        return {
            sent: sent,
            responded: responded,
            pending: (states.ready || 0) + (states.wip || 0),
            cancelled: (states.canceled || 0) + (states.expired || 0),
            responseRate: sent ? Math.round((responded / sent) * 1000) / 10 : 0
        };
    },

    _stateBars: function(states) {
        var labels = { complete: 'Completed', ready: 'Ready to take', wip: 'In progress', canceled: 'Cancelled', expired: 'Expired', '': '(no state)' };
        var order = ['complete', 'ready', 'wip', 'canceled', 'expired', ''];
        var bars = [];
        for (var i = 0; i < order.length; i++) {
            if (states[order[i]])
                bars.push({ id: order[i], label: labels[order[i]], count: states[order[i]] });
        }
        for (var s in states) {
            if (order.indexOf(s) == -1)
                bars.push({ id: s, label: s, count: states[s] });
        }
        return bars;
    },

    /**
     * Surveys sent per period (by sent date) beside the responses received in
     * the same period (by completion date), for surveys sent in the range.
     */
    _trend: function(encoded, range) {
        var sent = this._trendCounts(encoded, 'sys_created_on', range.bucket);
        var responded = this._trendCounts(encoded + '^state=complete^taken_onISNOTEMPTY', 'taken_on', range.bucket);
        var keys = this._bucketKeys(range, sent, responded);
        var buckets = [];
        for (var i = 0; i < keys.length; i++) {
            buckets.push({
                label: this._bucketLabel(keys[i], range.bucket),
                sent: sent[keys[i]] || 0,
                responded: responded[keys[i]] || 0
            });
        }
        return { bucket: range.bucket, buckets: buckets };
    },

    _trendCounts: function(encoded, field, bucket) {
        var counts = {};
        var ga = new GlideAggregate('asmt_assessment_instance');
        ga.addEncodedQuery(encoded);
        ga.addTrend(field, bucket);
        ga.addAggregate('COUNT');
        ga.query();
        while (ga.next())
            counts[this._bucketKey(ga.getValue('timeref'), bucket)] = parseInt(ga.getAggregate('COUNT'), 10);
        return counts;
    },

    // addTrend returns "M/YYYY" for months and "YYYY/YYYY" for years.
    _bucketKey: function(timeref, bucket) {
        var parts = String(timeref).split('/');
        if (bucket == 'Year')
            return parts[0];
        return parts[1] + '-' + (parts[0].length == 1 ? '0' + parts[0] : parts[0]);
    },

    _bucketKeys: function(range, sent, responded) {
        var keys = [];
        if (range.bucket == 'Month') {
            var first = this._monthIndex(range.from || range.to);
            var last = this._monthIndex(range.to);
            for (var m = first; m <= last; m++) {
                var month = (m % 12) + 1;
                keys.push(Math.floor(m / 12) + '-' + (month < 10 ? '0' + month : month));
            }
            return keys;
        }

        var years = Object.keys(sent).concat(Object.keys(responded)).map(Number).filter(function(y) { return y > 0; });
        if (range.from) years.push(parseInt(range.from.substring(0, 4), 10));
        if (range.to) years.push(parseInt(range.to.substring(0, 4), 10));
        if (!years.length)
            return keys;
        var lo = Math.min.apply(null, years);
        var hi = range.to ? parseInt(range.to.substring(0, 4), 10) : Math.max(Math.max.apply(null, years), parseInt(new GlideDateTime().getLocalDate().getValue().substring(0, 4), 10));
        for (var y = lo; y <= hi; y++)
            keys.push(String(y));
        return keys;
    },

    _bucketLabel: function(key, bucket) {
        if (bucket == 'Year')
            return key;
        var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return names[parseInt(key.substring(5, 7), 10) - 1] + ' ' + key.substring(2, 4);
    },

    _monthIndex: function(date) {
        return parseInt(date.substring(0, 4), 10) * 12 + parseInt(date.substring(5, 7), 10) - 1;
    },

    _surveyName: function(ctx) {
        for (var i = 0; i < ctx.surveys.length; i++) {
            if (ctx.surveys[i].sys_id == ctx.survey)
                return ctx.surveys[i].name;
        }
        return 'All surveys';
    },

    _surveyOptions: function(program) {
        var options = [];
        if (program.surveysProperty) {
            var names = gs.getProperty(program.surveysProperty, program.defaultSurveys).split(',')
                .map(function(name) { return name.trim(); })
                .filter(function(name) { return name; });
            var type = new GlideRecord('asmt_metric_type');
            type.addQuery('name', 'IN', names.join(','));
            type.query();
            while (type.next())
                options.push({ sys_id: type.getUniqueValue(), name: type.getValue('name') });
            options.sort(function(a, b) { return names.indexOf(a.name) - names.indexOf(b.name); });
            return options;
        }

        var ga = new GlideAggregate('asmt_assessment_instance');
        ga.addQuery('trigger_table', program.triggerTable);
        ga.addNotNullQuery('metric_type');
        ga.addAggregate('COUNT');
        ga.groupBy('metric_type');
        ga.query();
        while (ga.next())
            options.push({ sys_id: ga.getValue('metric_type'), name: ga.metric_type.getDisplayValue() });
        options.sort(function(a, b) { return a.name < b.name ? -1 : 1; });
        return options;
    },

    _bySurvey: function(encoded) {
        var rows = {};
        var order = [];
        var ga = new GlideAggregate('asmt_assessment_instance');
        ga.addEncodedQuery(encoded);
        ga.addAggregate('COUNT');
        ga.groupBy('metric_type');
        ga.groupBy('state');
        ga.query();
        while (ga.next()) {
            var id = ga.getValue('metric_type') || '';
            if (!rows[id]) {
                rows[id] = { name: id ? ga.metric_type.getDisplayValue() : '(no survey type)', sent: 0, responded: 0 };
                order.push(id);
            }
            var count = parseInt(ga.getAggregate('COUNT'), 10);
            rows[id].sent += count;
            if (ga.getValue('state') == 'complete')
                rows[id].responded += count;
        }
        return order.map(function(id) {
            var row = rows[id];
            row.responseRate = row.sent ? Math.round((row.responded / row.sent) * 1000) / 10 : 0;
            return row;
        }).sort(function(a, b) { return b.sent - a.sent; });
    },

    /**
     * Answer distribution per rating question from asmt_metric_result. Every
     * answer option is listed, highest value first, including ones nobody chose.
     */
    _questions: function(conditions) {
        var questions = {};
        var order = [];
        var ga = new GlideAggregate('asmt_metric_result');
        ga.addEncodedQuery(this._prefixed(conditions).join('^'));
        ga.addQuery('metric.datatype', 'IN', this.RATING_TYPES);
        ga.addAggregate('COUNT');
        ga.groupBy('metric');
        ga.groupBy('metric_definition');
        ga.query();
        while (ga.next()) {
            var metricId = ga.getValue('metric');
            if (!questions[metricId]) {
                questions[metricId] = {
                    sys_id: metricId,
                    name: ga.metric.getDisplayValue(),
                    survey: ga.metric.metric_type.getDisplayValue(),
                    answers: {},
                    total: 0
                };
                order.push(metricId);
            }
            var count = parseInt(ga.getAggregate('COUNT'), 10);
            questions[metricId].answers[ga.getValue('metric_definition') || ''] = count;
            questions[metricId].total += count;
        }

        var self = this;
        return order.map(function(metricId) {
            return self._questionBars(questions[metricId]);
        });
    },

    _questionBars: function(question) {
        var options = [];
        var seen = {};
        var def = new GlideRecord('asmt_metric_definition');
        def.addQuery('metric', question.sys_id);
        def.query();
        while (def.next()) {
            seen[def.getUniqueValue()] = true;
            options.push({
                label: def.getValue('display'),
                value: parseFloat(def.getValue('value')) || 0,
                count: question.answers[def.getUniqueValue()] || 0
            });
        }
        for (var id in question.answers) {
            if (!seen[id])
                options.push({ label: id ? '(retired option)' : '(no option)', value: 0, count: question.answers[id] });
        }
        options.sort(function(a, b) { return b.value - a.value; });

        var weighted = 0;
        var top = 0;
        options.forEach(function(option) {
            weighted += option.value * option.count;
            if (option.value > top) top = option.value;
            option.percent = question.total ? Math.round((option.count / question.total) * 1000) / 10 : 0;
        });
        return {
            name: question.name,
            survey: question.survey,
            total: question.total,
            average: question.total ? Math.round((weighted / question.total) * 100) / 100 : null,
            maxValue: top,
            options: options
        };
    },

    _comments: function(conditions) {
        var comments = [];
        var gr = new GlideRecord('asmt_metric_result');
        gr.addEncodedQuery(this._prefixed(conditions).join('^'));
        gr.addQuery('metric.datatype', 'string');
        gr.addNotNullQuery('string_value');
        gr.addQuery('string_value', '!=', this.UNANSWERED);
        gr.orderByDesc('sys_created_on');
        gr.setLimit(this.COMMENT_LIMIT);
        gr.query();
        while (gr.next()) {
            comments.push({
                text: gr.getValue('string_value'),
                question: gr.metric.getDisplayValue(),
                survey: gr.instance.metric_type.getDisplayValue(),
                user: gr.instance.user.getDisplayValue(),
                on: gr.instance.taken_on.getDisplayValue() || gr.getDisplayValue('sys_created_on'),
                instance: gr.getValue('instance')
            });
        }
        return comments;
    },

    _recent: function(encoded, program) {
        var rows = [];
        var gr = new GlideRecord('asmt_assessment_instance');
        gr.addEncodedQuery(encoded + '^state=complete');
        gr.orderByDesc('taken_on');
        gr.setLimit(this.RECENT_LIMIT);
        gr.query();
        var triggerIds = [];
        while (gr.next()) {
            triggerIds.push(gr.getValue('trigger_id'));
            rows.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getValue('number'),
                survey: gr.metric_type.getDisplayValue() || '(no survey type)',
                user: gr.user.getDisplayValue(),
                taken_on: gr.getDisplayValue('taken_on'),
                trigger_id: gr.getValue('trigger_id'),
                rating: this._primaryRating(gr.getUniqueValue())
            });
        }
        var sources = this._sources(program, triggerIds);
        rows.forEach(function(row) {
            var source = sources[row.trigger_id] || {};
            row.account = source.account || '';
            row.source = source.number || '';
            delete row.trigger_id;
        });
        return rows;
    },

    // The account and case number (or CSAT requester) behind each survey,
    // looked up in batches. Query rules on CSM tables hide partner accounts, so
    // they are bypassed.
    _sources: function(program, triggerIds) {
        var sources = {};
        var ids = this._unique(triggerIds);
        var accountField = program.id == 'csat' ? 'u_company' : 'account';
        for (var start = 0; start < ids.length; start += 500) {
            var gr = new GlideRecord(program.triggerTable);
            gr.setWorkflow(false);
            gr.addQuery('sys_id', 'IN', ids.slice(start, start + 500).join(','));
            gr.query();
            while (gr.next()) {
                var number = '';
                if (gr.isValidField('number'))
                    number = gr.getValue('number') || '';
                else if (gr.isValidField('u_requested_by') && !gr.u_requested_by.nil())
                    number = 'Request by ' + gr.getDisplayValue('u_requested_by');
                sources[gr.getUniqueValue()] = {
                    number: number,
                    account: gr.isValidField(accountField) ? gr.getDisplayValue(accountField) : ''
                };
            }
        }
        return sources;
    },

    /**
     * One row per survey sent, newest first, with each answer in a column
     * named after its question. Questions that share a name (the Manual and
     * Schedule surveys both ask "Overall Service Quality") share a column.
     */
    getExportRows: function(params, respondedOnly, limit) {
        var ctx = this._context(params);
        var max = limit || this.EXPORT_LIMIT;
        var rows = [];
        var triggerIds = [];
        var truncated = false;

        var gr = new GlideRecord('asmt_assessment_instance');
        gr.addEncodedQuery(ctx.encoded + (respondedOnly ? '^state=complete' : ''));
        gr.orderByDesc(respondedOnly ? 'taken_on' : 'sys_created_on');
        gr.setLimit(max + 1);
        gr.query();
        // Reference and choice labels are resolved once per value rather than
        // per row, which keeps a 10,000-row export to a few seconds.
        var userIds = [];
        var surveyNames = {};
        var stateLabels = {};
        while (gr.next()) {
            if (rows.length == max) {
                truncated = true;
                break;
            }
            var surveyId = gr.getValue('metric_type') || '';
            if (!(surveyId in surveyNames))
                surveyNames[surveyId] = surveyId ? gr.metric_type.getDisplayValue() : '(no survey type)';
            var state = gr.getValue('state') || '';
            if (!(state in stateLabels))
                stateLabels[state] = gr.getDisplayValue('state');
            triggerIds.push(gr.getValue('trigger_id'));
            userIds.push(gr.getValue('user'));
            rows.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getValue('number'),
                survey: surveyNames[surveyId],
                user_id: gr.getValue('user'),
                state: stateLabels[state],
                responded: state == 'complete',
                sent_on: gr.getDisplayValue('sys_created_on'),
                due_on: gr.getDisplayValue('due_date'),
                taken_on: gr.getDisplayValue('taken_on'),
                trigger_id: gr.getValue('trigger_id')
            });
        }

        var users = this._names('sys_user', userIds);
        var sources = this._sources(ctx.program, triggerIds);
        var answers = this._answers(ctx.conditions);
        rows.forEach(function(row) {
            var source = sources[row.trigger_id] || {};
            row.user = users[row.user_id] || '';
            row.account = source.account || '';
            row.source = source.number || '';
            row.answers = answers.byInstance[row.sys_id] || {};
            delete row.trigger_id;
            delete row.user_id;
        });

        return {
            program: ctx.program,
            range: ctx.range,
            surveyName: this._surveyName(ctx),
            questions: answers.columns,
            rows: rows,
            truncated: truncated,
            limit: max
        };
    },

    _unique: function(values) {
        var seen = {};
        return values.filter(function(value) {
            if (!value || seen[value])
                return false;
            seen[value] = true;
            return true;
        });
    },

    _names: function(table, sysIds) {
        var names = {};
        var ids = this._unique(sysIds);
        for (var start = 0; start < ids.length; start += 500) {
            var gr = new GlideRecord(table);
            gr.setWorkflow(false);
            gr.addQuery('sys_id', 'IN', ids.slice(start, start + 500).join(','));
            gr.query();
            while (gr.next())
                names[gr.getUniqueValue()] = gr.getDisplayValue();
        }
        return names;
    },

    _answers: function(conditions) {
        var columns = [];
        var byInstance = {};
        var gr = new GlideRecord('asmt_metric_result');
        gr.addEncodedQuery(this._prefixed(conditions).join('^') + '^instance.state=complete');
        gr.orderBy('metric.order');
        gr.query();
        while (gr.next()) {
            var question = gr.metric.getDisplayValue();
            if (columns.indexOf(question) == -1)
                columns.push(question);
            var value = gr.getValue('string_value');
            if (!value && !gr.metric_definition.nil())
                value = gr.metric_definition.getDisplayValue();
            if (!value)
                value = gr.getValue('actual_value') || '';
            if (value == this.UNANSWERED)
                continue;
            var instance = gr.getValue('instance');
            byInstance[instance] = byInstance[instance] || {};
            byInstance[instance][question] = value;
        }
        return { columns: columns, byInstance: byInstance };
    },

    /**
     * Renders the dashboard and its responses to a PDF attached to the
     * requesting user, replacing that user's previous dashboard PDF.
     */
    generatePdf: function(params) {
        var dash = this.getDashboard(params);
        var responses = this.getExportRows(params, true, this.PDF_RESPONSE_LIMIT);
        var userId = gs.getUserID();
        this._purgePdfs(userId);

        var name = this.PDF_PREFIX + '-' + dash.program.id + '-' + new GlideDateTime().getLocalDate().getValue();
        try {
            new sn_pdfgeneratorutils.PDFGenerationAPI().convertToPDF(this._pdfHtml(dash, responses), 'sys_user', userId, name);
        } catch (e) {
            return { error: 'PDF could not be generated: ' + e.message };
        }

        var att = new GlideRecord('sys_attachment');
        att.addQuery('table_name', 'sys_user');
        att.addQuery('table_sys_id', userId);
        att.addQuery('file_name', 'STARTSWITH', this.PDF_PREFIX);
        att.orderByDesc('sys_created_on');
        att.setLimit(1);
        att.query();
        if (!att.next())
            return { error: 'PDF was generated but the file could not be located.' };
        // sys_attachment.do bounces portal users to navpage.do instead of
        // serving the file.
        return {
            file_name: att.getValue('file_name'),
            url: '/api/now/attachment/' + att.getUniqueValue() + '/file'
        };
    },

    _purgePdfs: function(userId) {
        var att = new GlideRecord('sys_attachment');
        att.addQuery('table_name', 'sys_user');
        att.addQuery('table_sys_id', userId);
        att.addQuery('file_name', 'STARTSWITH', this.PDF_PREFIX);
        att.query();
        while (att.next())
            att.deleteRecord();
    },

    _pdfHtml: function(dash, responses) {
        var esc = function(v) {
            return GlideStringUtil.escapeHTML(v === null || v === undefined ? '' : String(v));
        };
        var bar = function(value, max, colour) {
            var width = value && max ? Math.max(1, Math.round((value / max) * 100)) : 0;
            return '<div class="track"><div style="background:' + colour + ';height:9px;width:' + width + '%;"></div></div>';
        };
        var maxOf = function(list, read) {
            return list.reduce(function(m, item) { return Math.max(m, read(item)); }, 0);
        };
        var s = dash.summary;
        var period = dash.range.from ? 'Sent ' + dash.range.from + ' to ' + dash.range.to : 'All surveys ever sent';
        var html = [];

        html.push('<html><head><meta charset="utf-8"/><style>');
        html.push('body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#25313d;}');
        html.push('h1{font-size:18px;margin:0 0 4px;} h2{font-size:13px;margin:16px 0 6px;} h3{font-size:11px;margin:10px 0 4px;}');
        html.push('.meta{color:#6b7580;font-size:9px;margin-bottom:12px;}');
        html.push('table{border-collapse:collapse;width:100%;margin-bottom:10px;}');
        html.push('th,td{border:1px solid #c8d1da;padding:3px 5px;text-align:left;vertical-align:top;}');
        html.push('th{background:#eef2f6;} td.n{text-align:right;width:50px;} td.b{width:45%;}');
        html.push('.track{background:#eef2f6;height:9px;width:100%;}');
        html.push('.tiles td{text-align:center;font-size:16px;font-weight:bold;color:#0b5cab;}');
        html.push('.tiles th{text-align:center;font-weight:normal;font-size:9px;color:#6b7580;}');
        html.push('</style></head><body>');

        html.push('<h1>Survey Management Dashboard: ' + esc(dash.program.label) + '</h1>');
        html.push('<div class="meta">' + esc(period) + ' &nbsp;|&nbsp; Survey: ' + esc(dash.surveyName) +
            '<br/>Generated ' + esc(new GlideDateTime().getDisplayValue()) + ' by ' + esc(gs.getUserDisplayName()) + '</div>');

        html.push('<table class="tiles"><tr><th>Surveys sent</th><th>Responses received</th><th>Response rate</th><th>Awaiting response</th><th>Cancelled / expired</th></tr>');
        html.push('<tr><td>' + s.sent + '</td><td>' + s.responded + '</td><td>' + s.responseRate + '%</td><td>' + s.pending + '</td><td>' + s.cancelled + '</td></tr></table>');

        var trendMax = maxOf(dash.trend.buckets, function(b) { return Math.max(b.sent, b.responded); });
        html.push('<h2>Sent vs responses by ' + (dash.trend.bucket == 'Year' ? 'year' : 'month') + '</h2>');
        html.push('<table><tr><th>Period</th><th>Sent</th><th class="b"></th><th>Responses</th><th class="b"></th></tr>');
        dash.trend.buckets.forEach(function(b) {
            html.push('<tr><td>' + esc(b.label) + '</td><td class="n">' + b.sent + '</td><td class="b">' + bar(b.sent, trendMax, '#9fb8d4') +
                '</td><td class="n">' + b.responded + '</td><td class="b">' + bar(b.responded, trendMax, '#0b5cab') + '</td></tr>');
        });
        html.push('</table>');

        var stateMax = maxOf(dash.states, function(st) { return st.count; });
        html.push('<h2>Survey status</h2><table><tr><th>Status</th><th>Surveys</th><th class="b"></th></tr>');
        dash.states.forEach(function(st) {
            html.push('<tr><td>' + esc(st.label) + '</td><td class="n">' + st.count + '</td><td class="b">' + bar(st.count, stateMax, '#0b5cab') + '</td></tr>');
        });
        html.push('</table>');

        html.push('<h2>By survey</h2><table><tr><th>Survey</th><th>Sent</th><th>Responses</th><th>Rate</th></tr>');
        dash.bySurvey.forEach(function(b) {
            html.push('<tr><td>' + esc(b.name) + '</td><td class="n">' + b.sent + '</td><td class="n">' + b.responded + '</td><td class="n">' + b.responseRate + '%</td></tr>');
        });
        html.push('</table>');

        if (dash.questions.length) {
            html.push('<h2>How people answered</h2>');
            dash.questions.forEach(function(q) {
                var optionMax = maxOf(q.options, function(o) { return o.count; });
                html.push('<h3>' + esc(q.name) + ' <span class="meta">' + esc(q.survey) +
                    (q.average !== null ? ' &middot; average ' + q.average + (q.maxValue ? ' / ' + q.maxValue : '') : '') +
                    ' &middot; ' + q.total + ' answers</span></h3>');
                html.push('<table><tr><th>Answer</th><th>Count</th><th>%</th><th class="b"></th></tr>');
                q.options.forEach(function(o) {
                    html.push('<tr><td>' + esc(o.label) + '</td><td class="n">' + o.count + '</td><td class="n">' + o.percent + '%</td><td class="b">' + bar(o.count, optionMax, '#0b5cab') + '</td></tr>');
                });
                html.push('</table>');
            });
        }

        html.push('<h2>Responses received (' + responses.rows.length + ')</h2>');
        if (responses.rows.length) {
            html.push('<table><tr><th>Survey</th><th>Taken</th><th>By</th><th>Account</th><th>From</th>');
            responses.questions.forEach(function(q) { html.push('<th>' + esc(q) + '</th>'); });
            html.push('</tr>');
            responses.rows.forEach(function(r) {
                html.push('<tr><td>' + esc(r.number) + '<br/>' + esc(r.survey) + '</td><td>' + esc(r.taken_on) + '</td><td>' + esc(r.user) +
                    '</td><td>' + esc(r.account) + '</td><td>' + esc(r.source) + '</td>');
                responses.questions.forEach(function(q) { html.push('<td>' + esc(r.answers[q]) + '</td>'); });
                html.push('</tr>');
            });
            html.push('</table>');
        }
        if (responses.truncated)
            html.push('<div class="meta">Only the latest ' + responses.limit + ' responses are listed. Use the Excel or CSV export for every survey.</div>');

        html.push('</body></html>');
        return html.join('');
    },

    // The first rating question answered, shown as "label (value)".
    _primaryRating: function(instanceId) {
        var gr = new GlideRecord('asmt_metric_result');
        gr.addQuery('instance', instanceId);
        gr.addQuery('metric.datatype', 'IN', this.RATING_TYPES);
        gr.orderBy('metric.order');
        gr.setLimit(1);
        gr.query();
        if (!gr.next())
            return '';
        var label = gr.metric_definition.getDisplayValue();
        return gr.metric.getDisplayValue() + ': ' + (label || gr.getValue('actual_value'));
    },

    type: 'CSATDashboard'
};
