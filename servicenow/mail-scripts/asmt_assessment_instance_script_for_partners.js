// Prints the survey link for the "Survey User Invite v2- Manually Created"
// template. The original resolved the account from current.task_id.company,
// which only exists for case-triggered surveys. Surveys raised from the CSAT
// portal have no task, so nothing was printed and the invitation went out with
// no way to reach the survey.
//
// The case path below is unchanged. A fallback resolves the account from the
// CSAT survey request and links to the Service Portal instead of the platform.

var partner = new GlideRecord('customer_account');
partner.addQuery('sys_id', current.task_id.company);
partner.query();
if (partner.next()) {
    var partner_name = partner.account_parent.name;
    if (partner.account_parent.name == '') {
        partner_name = partner.name;
    }
    var html = new AssessmentUtilsPartner().getInstanceLinkHTML(current, partner_name);
    template.print(html);

	// for CSAT
} else if (current.getValue('trigger_table') == 'u_x_csat_survey_request') {
    var base = (gs.getProperty('glide.servlet.uri') + '').replace(/\/+$/, '');
    var url = base + '/csat?id=take_survey&instance_id=' + current.getUniqueValue();

    template.print(
        '<p style="text-align: left;">' +
        '<a href="' + url + '" ' +
        'style="background:#0b5cab;color:#ffffff;padding:12px 24px;border-radius:4px;' +
        'text-decoration:none;display:inline-block;font-weight:bold;">Take the survey</a>' +
        '</p>'
    );

    // Many corporate mail clients strip styled anchors.
    template.print(
        '<p style="text-align: left; font-size: 12px; color: #666666;">' +
        'If the button does not work, copy this link into your browser:<br/>' +
        url +
        '</p>'
    );
}
