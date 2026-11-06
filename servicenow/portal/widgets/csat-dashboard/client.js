api.controller = function($scope, $location) {
    var c = this;

    function syncFilters() {
        var d = c.data.dashboard;
        c.filters = {
            program: d.program.id,
            range: d.range.id,
            from: d.range.from ? toDate(d.range.from) : null,
            to: d.range.to ? toDate(d.range.to) : null,
            survey: d.survey || ''
        };
        c.tiles = [
            { label: 'Surveys sent', value: d.summary.sent },
            { label: 'Responses received', value: d.summary.responded },
            { label: 'Response rate', value: d.summary.responseRate + '%' },
            { label: 'Awaiting response', value: d.summary.pending },
            { label: 'Cancelled / expired', value: d.summary.cancelled }
        ];
        c.trendMax = Math.max.apply(null, [1].concat(d.trend.buckets.map(function(b) { return Math.max(b.sent, b.responded); })));
        c.stateMax = Math.max.apply(null, [1].concat(d.states.map(function(s) { return s.count; })));
        c.surveyMax = Math.max.apply(null, [1].concat(d.bySurvey.map(function(s) { return s.sent; })));
    }

    function toDate(value) {
        var parts = value.split('-');
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }

    function toValue(date) {
        if (!date) return '';
        var m = date.getMonth() + 1;
        var d = date.getDate();
        return date.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
    }

    c.load = function() {
        if (c.filters.range === 'custom' && (!c.filters.from || !c.filters.to)) {
            c.error = 'Choose both a from and a to date.';
            return;
        }
        c.error = '';
        c.loading = true;
        c.server.get({
            action: 'load',
            program: c.filters.program,
            range: c.filters.range,
            from: toValue(c.filters.from),
            to: toValue(c.filters.to),
            survey: c.filters.survey
        }).then(function(response) {
            c.loading = false;
            c.data.dashboard = response.data.dashboard;
            syncFilters();
        }, function() {
            c.loading = false;
            c.error = 'The dashboard could not be loaded. Please try again.';
        });
    };

    c.selectProgram = function(id) {
        if (c.filters.program === id) return;
        c.filters.program = id;
        c.filters.survey = '';
        $location.search('program', id);
        c.load();
    };

    c.onRangeChange = function() {
        if (c.filters.range !== 'custom') c.load();
    };

    c.height = function(value) {
        return value ? Math.max(2, Math.round((value / c.trendMax) * 100)) + '%' : '0';
    };

    c.width = function(value, max) {
        return value ? Math.max(1, Math.round((value / (max || 1)) * 100)) + '%' : '0';
    };

    c.optionMax = function(question) {
        return Math.max.apply(null, [1].concat(question.options.map(function(o) { return o.count; })));
    };

    c.instanceUrl = function(sysId) {
        return '/asmt_assessment_instance.do?sys_id=' + sysId;
    };

    syncFilters();
};
