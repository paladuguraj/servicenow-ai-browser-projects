var CSATDashboard = Class.create();
CSATDashboard.prototype = {
    initialize: function() {},

    // Each option is a fixed slice of asmt_assessment_instance, told apart by
    // what raised the survey: closed cases, or CSAT Survey Requests (which
    // covers both the Manual and the Automatic survey).
    PROGRAMS: [
        { id: 'case', label: 'Case Survey', triggerTable: 'sn_customerservice_case' },
        { id: 'csat', label: 'CSAT (Manual + Automatic)', triggerTable: 'u_x_csat_survey_request' }
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

    getOptions: function() {
        return { programs: this.PROGRAMS, ranges: this.RANGES };
    },

    getDashboard: function(params) {
        params = params || {};
        var program = this._program(params.program);
        var range = this._range(params.range, params.from, params.to);
        var conditions = this._conditions(program, range, params.survey);
        var encoded = conditions.join('^');

        var states = this._countBy(encoded, 'state');
        var summary = this._summary(states);

        return {
            program: program,
            range: range,
            survey: params.survey || '',
            surveys: this._surveyOptions(program),
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

    _conditions: function(program, range, survey) {
        var parts = ['trigger_table=' + program.triggerTable];
        if (range.from)
            parts.push("sys_created_on>=javascript:gs.dateGenerate('" + range.from + "','start')");
        if (range.to)
            parts.push("sys_created_on<=javascript:gs.dateGenerate('" + range.to + "','end')");
        if (survey && /^[0-9a-f]{32}$/.test(survey))
            parts.push('metric_type=' + survey);
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

    _surveyOptions: function(program) {
        var options = [];
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
        while (gr.next()) {
            var source = this._source(program, gr.getValue('trigger_id'));
            rows.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getValue('number'),
                survey: gr.metric_type.getDisplayValue() || '(no survey type)',
                user: gr.user.getDisplayValue(),
                taken_on: gr.getDisplayValue('taken_on'),
                account: source.account,
                source: source.number,
                rating: this._primaryRating(gr.getUniqueValue())
            });
        }
        return rows;
    },

    _source: function(program, triggerId) {
        var result = { account: '', number: '' };
        if (!triggerId)
            return result;
        var gr = new GlideRecord(program.triggerTable);
        gr.setWorkflow(false);
        if (!gr.get(triggerId))
            return result;
        if (gr.isValidField('number'))
            result.number = gr.getValue('number') || '';
        else if (gr.isValidField('u_requested_by') && !gr.u_requested_by.nil())
            result.number = 'Request by ' + gr.getDisplayValue('u_requested_by');
        var accountField = program.id == 'csat' ? 'u_company' : 'account';
        if (gr.isValidField(accountField))
            result.account = gr.getDisplayValue(accountField);
        return result;
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
