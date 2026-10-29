(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    // Public image endpoint for the CSAT email logo. Gmail and Outlook do not
    // display base64 data: images and cannot fetch instance attachments without a
    // login, so the email links here instead. Gmail fetches through its image
    // proxy, which carries no credentials, hence no authentication.
    //
    // Only the default logo and the banner images of white-label partners are
    // served; any other attachment id returns 404.

    function notFound() {
        response.setStatus(404);
    }

    function isAllowedLogo(attachmentId) {
        if (attachmentId == (gs.getProperty('csat.logo.default_attachment_sys_id') || '').trim())
            return true;
        var account = new GlideRecord('customer_account');
        account.setWorkflow(false);
        account.addQuery('banner_image', attachmentId);
        account.addQuery('u_is_white_label_partner', true);
        account.setLimit(1);
        account.query();
        return account.hasNext();
    }

    var match = String(request.pathParams.file || '').match(/^([0-9a-f]{32})(\.(png|jpg|gif))?$/);
    if (!match || !isAllowedLogo(match[1]))
        return notFound();

    var attachment = new GlideRecord('sys_attachment');
    if (!attachment.get(match[1]))
        return notFound();

    response.setContentType(attachment.getValue('content_type') || 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.setStatus(200);
    response.getStreamWriter().writeStream(new GlideSysAttachment().getContentStream(match[1]));
})(request, response);
