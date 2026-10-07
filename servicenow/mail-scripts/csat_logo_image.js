(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */
    email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */
    event) {

    // Prints the CSAT logo as a centered email header using a base64 data URI.
    // The image is read from the db_image table and embedded directly in the
    // HTML, so it does not depend on external URLs, authentication, or the
    // recipient's access to the instance.

    var gr = new GlideRecord('db_image');
    gr.addQuery('name', 'csat_logo.png');
    gr.addQuery('active', true);
    gr.query();
    if (!gr.next()) {
        gs.warn('CSAT logo db_image "csat_logo.png" not found');
        return;
    }

    var base64 = gr.getValue('image');
    if (!base64) {
        gs.warn('CSAT logo db_image has no image data');
        return;
    }

    template.print(
        '<div style="text-align:center;margin-bottom:24px;">' +
        '<img src="data:image/png;base64,' + base64 + '" alt="Network Operations CSAT Survey" style="max-width:280px;height:auto;" />' +
        '</div>'
    );

})(current, template, email, email_action, event);