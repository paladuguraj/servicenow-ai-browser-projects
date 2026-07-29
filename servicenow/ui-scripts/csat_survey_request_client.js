function csatAjax(name, params) {
  var body = 'sysparm_processor=CSATSurveyAjax&sysparm_name=' + encodeURIComponent(name);
  if (params) {
    Object.keys(params).forEach(function(key) {
      body += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    });
  }
  return fetch('/xmlhttp.do', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-UserToken': window.g_ck || ''
    },
    body: body
  }).then(function(res) {
    return res.text();
  }).then(function(text) {
    var parser = new DOMParser();
    var xml = parser.parseFromString(text, 'text/xml');
    var answer = xml.documentElement ? xml.documentElement.getAttribute('answer') : null;
    if (!answer) {
      var err = xml.documentElement ? xml.documentElement.getAttribute('error') : null;
      throw new Error(err || 'Request failed');
    }
    return JSON.parse(answer);
  });
}

function csatPopulateSelect(selectId, items) {
  var select = document.getElementById(selectId);
  for (var i = 0; i < items.length; i++) {
    var opt = document.createElement('option');
    opt.value = items[i].sys_id;
    opt.textContent = items[i].name;
    select.appendChild(opt);
  }
}

function csatShowMessage(text, type) {
  var el = document.getElementById('message');
  el.textContent = text;
  el.className = 'message ' + type;
  el.style.display = 'block';
}

function csatRenderUsers(users) {
  var panel = document.getElementById('usersPanel');
  if (!users || !users.length) {
    panel.innerHTML = '<div class="hint">No active users found for this company.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    html += '<div class="user-row"><input type="checkbox" class="user-checkbox" value="' + u.sys_id + '" id="user_' + u.sys_id + '">';
    html += '<label for="user_' + u.sys_id + '">' + u.name + ' (' + (u.email || u.user_name) + ')</label></div>';
  }
  panel.innerHTML = html;
  csatUpdateUserSelectionState();
}

function csatUpdateUserSelectionState() {
  var selectedOnly = document.querySelector('input[name="recipient_mode"]:checked').value === 'selected_users';
  var boxes = document.querySelectorAll('.user-checkbox');
  for (var i = 0; i < boxes.length; i++) {
    boxes[i].disabled = !selectedOnly;
    if (!selectedOnly) boxes[i].checked = false;
  }
}

function csatBootPage() {
  if (!document.getElementById('company') || !window.g_ck) {
    window.setTimeout(csatBootPage, 200);
    return;
  }

  csatAjax('getCompanies').then(function(companies) {
    csatPopulateSelect('company', companies);
  }).catch(function() { csatShowMessage('Failed to load companies.', 'error'); });

  csatAjax('getTemplates').then(function(templates) {
    csatPopulateSelect('metric_type', templates);
  }).catch(function() { csatShowMessage('Failed to load survey templates.', 'error'); });

  document.getElementById('company').addEventListener('change', function(e) {
    var companyId = e.target.value;
    if (!companyId) {
      document.getElementById('usersPanel').innerHTML = '<div class="hint">Select a company to load users.</div>';
      return;
    }
    csatAjax('getUsers', { sysparm_company_id: companyId }).then(csatRenderUsers);
  });

  var radios = document.querySelectorAll('input[name="recipient_mode"]');
  for (var r = 0; r < radios.length; r++) radios[r].addEventListener('change', csatUpdateUserSelectionState);
  document.getElementById('resetBtn').addEventListener('click', function() { location.reload(); });

  document.getElementById('submitBtn').addEventListener('click', function() {
    var company = document.getElementById('company').value;
    var metric_type = document.getElementById('metric_type').value;
    var recipient_mode = document.querySelector('input[name="recipient_mode"]:checked').value;
    var schedule_frequency = document.getElementById('schedule_frequency').value;
    var notes = document.getElementById('notes').value;
    var selected = document.querySelectorAll('.user-checkbox:checked');
    var selected_users = [];
    for (var x = 0; x < selected.length; x++) selected_users.push(selected[x].value);
    if (!company || !metric_type) { csatShowMessage('Company and survey template are required.', 'error'); return; }
    if (recipient_mode === 'selected_users' && !selected_users.length) { csatShowMessage('Select at least one user.', 'error'); return; }

    csatAjax('createRequest', {
      sysparm_company: company,
      sysparm_metric_type: metric_type,
      sysparm_recipient_mode: recipient_mode,
      sysparm_schedule_frequency: schedule_frequency,
      sysparm_notes: notes,
      sysparm_selected_users: selected_users.join(','),
      sysparm_submit: 'true'
    }).then(function(result) {
      if (result.error) {
        csatShowMessage(result.error, 'error');
        return;
      }
      csatShowMessage('Survey request ' + (result.number || result.sys_id) + ' created. State: ' + result.state, 'success');
    }).catch(function() { csatShowMessage('Failed to create survey request.', 'error'); });
  });
}

window.addEventListener('load', function() {
  window.setTimeout(csatBootPage, 300);
});
