api.controller = function($scope, $timeout, $window, spModal, spUtil) {
    var c = this;

    var BLANK_FORM = {
        company: '',
        companyName: '',
        metric_type: '',
        recipient_mode: 'primary_user',
        schedule_frequency: 'immediate',
        notes: '',
        selected_users: {}
    };

    c.form = angular.copy(BLANK_FORM);
    c.companySearch = '';
    c.userFilter = '';
    c.showCompanyList = false;
    var searchTimer = null;

    /* ---------- company lookup ---------- */

    c.onCompanySearch = function() {
        c.showCompanyList = true;
        if (searchTimer) $timeout.cancel(searchTimer);
        // Debounced so typing does not fire a request per keystroke.
        searchTimer = $timeout(function() {
            c.searching = true;
            c.server.get({ action: 'searchCompanies', term: c.companySearch }).then(function(r) {
                c.data.companies = r.data.companies || [];
                c.searching = false;
            });
        }, 300);
    };

    c.selectCompany = function(company) {
        c.form.company = company.sys_id;
        c.form.companyName = company.name;
        c.companySearch = company.name;
        c.showCompanyList = false;
        c.loadCompany();
    };

    c.clearCompany = function() {
        c.form.company = '';
        c.form.companyName = '';
        c.companySearch = '';
        c.form.selected_users = {};
        c.data.users = [];
        c.data.primaryContact = null;
        c.showCompanyList = false;
    };

    c.loadCompany = function() {
        if (!c.form.company) return;
        c.loadingCompany = true;
        c.server.get({ action: 'loadCompany', company_id: c.form.company }).then(function(r) {
            c.data.users = r.data.users || [];
            c.data.primaryContact = r.data.primaryContact || null;
            c.form.selected_users = {};
            c.userFilter = '';
            c.loadingCompany = false;
        });
    };

    /* ---------- survey template ---------- */

    c.selectedTemplate = function() {
        var templates = c.data.templates || [];
        for (var i = 0; i < templates.length; i++) {
            if (templates[i].sys_id === c.form.metric_type) return templates[i];
        }
        return null;
    };

    c.isImmediateOnly = function() {
        var t = c.selectedTemplate();
        return !!(t && t.immediate_only);
    };

    c.draftTemplates = function() {
        return (c.data.templates || []).filter(function(t) { return !t.published; });
    };

    c.onTemplateChange = function() {
        // Case-outcome surveys are one-off, so drop any recurring choice.
        if (c.isImmediateOnly()) c.form.schedule_frequency = 'immediate';
    };

    c.availableSchedules = function() {
        var options = c.data.scheduleOptions || [];
        if (!c.isImmediateOnly()) return options;
        return options.filter(function(o) { return o.value === 'immediate'; });
    };

    /* ---------- recipients ---------- */

    c.primaryEligible = function() {
        return !!(c.data.primaryContact && c.data.primaryContact.eligible);
    };

    c.primaryName = function() {
        var p = c.data.primaryContact;
        if (!p || !p.user) return '';
        return p.user.name + ' (' + (p.user.email || p.user.user_name) + ')';
    };

    c.eligibleUsers = function() {
        return (c.data.users || []).filter(function(u) { return u.eligible; });
    };

    c.filteredUsers = function() {
        var term = (c.userFilter || '').toLowerCase().trim();
        var eligible = c.eligibleUsers();
        if (!term) return eligible;
        return eligible.filter(function(u) {
            return (u.name || '').toLowerCase().indexOf(term) !== -1 ||
                   (u.email || '').toLowerCase().indexOf(term) !== -1 ||
                   (u.user_name || '').toLowerCase().indexOf(term) !== -1;
        });
    };

    // Large accounts can have thousands of users; render a slice and let the
    // filter narrow it rather than paint the whole list.
    var MAX_VISIBLE = 50;

    c.visibleUsers = function() {
        return c.filteredUsers().slice(0, MAX_VISIBLE);
    };

    c.selectedUsers = function() {
        var ids = c.form.selected_users;
        return (c.data.users || []).filter(function(u) { return ids[u.sys_id]; });
    };

    c.clearSelection = function() {
        c.form.selected_users = {};
    };

    c.blockedUsers = function() {
        return (c.data.users || []).filter(function(u) { return !u.eligible; });
    };

    c.isUserSelected = function(userId) {
        return !!c.form.selected_users[userId];
    };

    c.toggleUser = function(user) {
        if (!user.eligible) return;
        if (c.form.selected_users[user.sys_id]) delete c.form.selected_users[user.sys_id];
        else c.form.selected_users[user.sys_id] = true;
    };

    c.getSelectedUserIds = function() {
        return Object.keys(c.form.selected_users).filter(function(k) {
            return c.form.selected_users[k];
        });
    };

    c.recipientCount = function() {
        if (c.form.recipient_mode === 'primary_user') return c.primaryEligible() ? 1 : 0;
        return c.getSelectedUserIds().length;
    };

    /* ---------- submit ---------- */

    c.requestSend = function() {
        c.data.message = '';
        c.data.messageType = '';
        c.pendingConfirmation = false;

        if (!c.form.company) {
            return c.fail('Select a company.');
        }
        if (!c.form.metric_type) {
            return c.fail('Select a survey template.');
        }
        var template = c.selectedTemplate();
        if (template && !template.published) {
            return c.fail('"' + template.name + '" is still in Draft. Publish it in Survey Designer before sending.');
        }
        if (c.form.recipient_mode === 'primary_user' && !c.primaryEligible()) {
            var p = c.data.primaryContact;
            return c.fail(p && p.reason ? p.reason : 'This company has no eligible primary user.');
        }
        if (c.form.recipient_mode === 'selected_users' && !c.getSelectedUserIds().length) {
            return c.fail('Select at least one user.');
        }

        c.pendingConfirmation = true;
    };

    c.fail = function(message) {
        c.data.message = message;
        c.data.messageType = 'danger';
    };

    c.cancelConfirmation = function() {
        c.pendingConfirmation = false;
    };

    c.submit = function() {
        c.pendingConfirmation = false;
        c.data.message = '';
        c.data.messageType = '';
        c.submitting = true;

        c.server.get({
            action: 'createRequest',
            company: c.form.company,
            metric_type: c.form.metric_type,
            recipient_mode: c.form.recipient_mode,
            schedule_frequency: c.form.schedule_frequency,
            notes: c.form.notes,
            selected_users: c.getSelectedUserIds().join(',')
        }).then(function(response) {
            c.submitting = false;
            var result = response.data.result;

            if (!result) return c.fail('Failed to create survey request.');
            if (result.error) return c.fail(result.error);

            c.showSubmittedDialog(result);
        }, function() {
            c.submitting = false;
            c.fail('Failed to create survey request.');
        });
    };

    c.showSubmittedDialog = function(result) {
        var stats = result.executions || {};
        var sent = stats.success || 0;
        var lines = [];

        if (result.schedule_frequency !== 'immediate') {
            lines.push('The request has been scheduled (' + c.scheduleLabel(result.schedule_frequency) + ').');
            if (result.next_run) lines.push('First run: ' + result.next_run + '.');
        } else if (sent) {
            lines.push(sent + ' survey ' + (sent === 1 ? 'invitation has' : 'invitations have') + ' been sent.');
        } else {
            lines.push('No surveys were sent.');
        }

        if (stats.skipped) lines.push(stats.skipped + ' recipient(s) skipped: ' + (stats.first_error || 'not eligible'));
        if (stats.failed) lines.push(stats.failed + ' failed: ' + (stats.first_error || 'see execution log'));

        spModal.open({
            title: 'Survey request submitted',
            message: lines.join(' '),
            buttons: [
                { label: 'View this request', value: 'view' },
                { label: 'Create another survey', value: 'new', primary: true }
            ]
        }).then(function(choice) {
            // Depending on the platform version this resolves with the button's
            // value or with the button object itself.
            var value = choice && choice.value !== undefined ? choice.value : choice;
            if (value === 'view') c.openRequestList(result);
            else c.startNewRequest();
        }, function() {
            c.startNewRequest();
        });
    };

    /**
     * Opens the execution log filtered to the request that was just submitted,
     * so the recipients and their outcomes are visible immediately.
     */
    c.openRequestList = function(result) {
        var url = '?id=list&table=u_x_csat_survey_execution' +
                  '&filter=' + encodeURIComponent('u_survey_request=' + result.sys_id);
        $window.location.href = url;
    };

    /* ---------- reset ---------- */

    c.startNewRequest = function() {
        c.reset();
        spUtil.addInfoMessage('Survey request submitted. Ready for the next one.');
    };

    c.scheduleLabel = function(value) {
        if (value === 'every_30_days') return 'every 30 days';
        if (value === 'every_60_days') return 'every 60 days';
        return 'immediate';
    };

    c.reset = function() {
        c.form = angular.copy(BLANK_FORM);
        c.companySearch = '';
        c.userFilter = '';
        c.showCompanyList = false;
        c.data.users = [];
        c.data.primaryContact = null;
        c.data.message = '';
        c.data.messageType = '';
        c.pendingConfirmation = false;
    };
};
