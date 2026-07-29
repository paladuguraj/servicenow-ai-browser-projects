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

    c.submit = function() {
        c.data.message = '';
        c.data.messageType = '';

        if (!c.form.company || !c.form.metric_type) {
            c.data.message = 'Company and survey template are required.';
            c.data.messageType = 'danger';
            return;
        }

        var selected = c.getSelectedUserIds();
        if (c.form.recipient_mode === 'selected_users' && !selected.length) {
            c.data.message = 'Select at least one user.';
            c.data.messageType = 'danger';
            return;
        }

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
            c.data.message = 'Survey request ' + (result.number || result.sys_id) + ' created. State: ' + result.state;
            c.data.messageType = 'success';
            spUtil.addInfoMessage(c.data.message);
        }, function() {
            c.submitting = false;
            c.data.message = 'Failed to create survey request.';
            c.data.messageType = 'danger';
        });
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
    };
};
