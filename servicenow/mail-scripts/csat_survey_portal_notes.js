(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the note captured on the survey request, which is seeded with the
    // survey name and may carry extra context from the requester. Nothing is
    // printed when the note is empty so the email does not show a stray blank.

    var requestGr = new GlideRecord('u_x_csat_survey_request');
    if (!requestGr.get(current.getValue('trigger_id') + ''))
        return;

    var notes = (requestGr.getValue('u_notes') || '').trim();
    if (!notes)
        return;

    template.print(
        '<p style="text-align: left;"><strong>' +
        GlideStringUtil.escapeHTML(notes) +
        '</strong></p>'
    );

})(current, template, email, email_action, event);
