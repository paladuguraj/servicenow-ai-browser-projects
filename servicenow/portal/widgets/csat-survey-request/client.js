api.controller = function($scope, spUtil) {
    var c = this;

    c.form = {
        company: '',
        metric_type: '',
        recipient_mode: 'all_users',
        schedule_frequency: 'immediate',
        notes: '',
        selected_users: {}
    };

    c.loadUsers = function() {
        if (!c.form.company) {
            c.data.users = [];
            c.form.selected_users = {};
            return;
        }

        c.server.get({
            action: 'getUsers',
            company_id: c.form.company
        }).then(function(response) {
            c.data.users = response.data.users || [];
            c.form.selected_users = {};
        });
    };

    c.isUserSelected = function(userId) {
        return !!c.form.selected_users[userId];
    };

    c.toggleUser = function(userId) {
        if (c.form.selected_users[userId]) {
            delete c.form.selected_users[userId];
        } else {
            c.form.selected_users[userId] = true;
        }
    };

    c.getSelectedUserIds = function() {
        return Object.keys(c.form.selected_users).filter(function(key) {
            return c.form.selected_users[key];
        });
    };

    c.recipientCount = function() {
        if (c.form.recipient_mode === 'selected_users')
            return c.getSelectedUserIds().length;
        return (c.data.users || []).length;
    };

    c.requestSend = function() {
        c.data.message = '';
        c.data.messageType = '';
        c.pendingConfirmation = false;

        if (!c.form.company || !c.form.metric_type) {
            c.data.message = 'Company and survey template are required.';
            c.data.messageType = 'danger';
            return;
        }

        if (c.form.recipient_mode === 'selected_users' && !c.getSelectedUserIds().length) {
            c.data.message = 'Select at least one user.';
            c.data.messageType = 'danger';
            return;
        }

        if (!c.recipientCount()) {
            c.data.message = 'No active users with an email address were found for this company, so there is nobody to survey.';
            c.data.messageType = 'warning';
            return;
        }

        // Sending to a whole company emails everyone at once, so make the
        // blast size explicit before anything leaves the instance.
        c.pendingConfirmation = true;
    };

    c.cancelConfirmation = function() {
        c.pendingConfirmation = false;
    };

    c.submit = function() {
        c.pendingConfirmation = false;
        c.data.message = '';
        c.data.messageType = '';

        var selected = c.getSelectedUserIds();
        c.submitting = true;
        c.server.get({
            action: 'createRequest',
            company: c.form.company,
            metric_type: c.form.metric_type,
            recipient_mode: c.form.recipient_mode,
            schedule_frequency: c.form.schedule_frequency,
            notes: c.form.notes,
            selected_users: selected.join(',')
        }).then(function(response) {
            c.submitting = false;
            var result = response.data.result;
            if (!result) {
                c.data.message = 'Failed to create survey request.';
                c.data.messageType = 'danger';
                return;
            }
            if (result.error) {
                c.data.message = result.error;
                c.data.messageType = 'danger';
                return;
            }
            c.data.message = c.describeResult(result);
            c.data.messageType = c.resultSeverity(result);
            spUtil.addInfoMessage(c.data.message);
        }, function() {
            c.submitting = false;
            c.data.message = 'Failed to create survey request.';
            c.data.messageType = 'danger';
        });
    };

    c.describeResult = function(result) {
        var label = 'Survey request ' + (result.number || result.sys_id);
        var stats = result.executions || {};

        if (result.schedule_frequency !== 'immediate') {
            return label + ' scheduled (' + c.scheduleLabel(result.schedule_frequency) +
                '). First run: ' + (result.next_run || 'shortly') + '.';
        }

        if (!stats.total)
            return label + ' created, but no surveys were sent: the selected company has no active users with an email address.';

        if (stats.success && !stats.failed && !stats.skipped)
            return label + ': ' + stats.success + ' survey ' + (stats.success === 1 ? 'invitation' : 'invitations') + ' sent.';

        var parts = [];
        if (stats.success) parts.push(stats.success + ' sent');
        if (stats.failed) parts.push(stats.failed + ' failed');
        if (stats.skipped) parts.push(stats.skipped + ' skipped');
        var summary = label + ': ' + parts.join(', ') + '.';
        if (stats.first_error) summary += ' First issue: ' + stats.first_error;
        return summary;
    };

    c.resultSeverity = function(result) {
        var stats = result.executions || {};
        if (result.schedule_frequency !== 'immediate') return 'success';
        if (!stats.total) return 'warning';
        if (stats.failed) return stats.success ? 'warning' : 'danger';
        return 'success';
    };

    c.companyName = function() {
        var companies = c.data.companies || [];
        for (var i = 0; i < companies.length; i++) {
            if (companies[i].sys_id === c.form.company)
                return companies[i].name;
        }
        return 'the selected company';
    };

    c.scheduleLabel = function(value) {
        if (value === 'every_30_days') return 'every 30 days';
        if (value === 'every_60_days') return 'every 60 days';
        return 'immediate';
    };

    c.reset = function() {
        c.form = {
            company: '',
            metric_type: '',
            recipient_mode: 'all_users',
            schedule_frequency: 'immediate',
            notes: '',
            selected_users: {}
        };
        c.data.users = [];
        c.data.message = '';
        c.data.messageType = '';
        c.pendingConfirmation = false;
    };
};
