api.controller = function($scope) {
    var c = this;

    c.filters = {
        metric_type: '',
        company: '',
        sent_from: '',
        sent_to: '',
        response: 'all'
    };

    c.responseOptions = [
        { value: 'all', label: 'All sent surveys' },
        { value: 'replied', label: 'Replied only' },
        { value: 'not_replied', label: 'Awaiting reply only' }
    ];

    c.run = function() {
        c.running = true;
        c.error = '';
        c.server.get(angular.extend({ action: 'run' }, c.filters)).then(function(r) {
            c.running = false;
            c.data.results = r.data.results;
            c.data.breakdown = r.data.breakdown;
            c.excelUrl = r.data.excelUrl;
            c.hasRun = true;
        }, function() {
            c.running = false;
            c.error = 'The report could not be run. Please try again.';
        });
    };

    c.reset = function() {
        c.filters = { metric_type: '', company: '', sent_from: '', sent_to: '', response: 'all' };
        c.data.results = null;
        c.data.breakdown = null;
        c.excelUrl = '';
        c.hasRun = false;
        c.error = '';
    };

    c.summary = function() {
        return (c.data.results && c.data.results.summary) || null;
    };

    c.rows = function() {
        return (c.data.results && c.data.results.rows) || [];
    };

    /**
     * Built in the browser from the rows already returned, so exporting does
     * not re-run the query or hit the row cap a second time.
     */
    c.exportCsv = function() {
        var rows = c.rows();
        if (!rows.length) return;

        var header = ['Account', 'Survey', 'Recipient', 'Email', 'Sent on', 'Replied', 'Replied on', 'Score', 'Comments'];
        var lines = [header.map(quote).join(',')];

        rows.forEach(function(r) {
            lines.push([
                r.account, r.survey, r.recipient, r.email, r.sent_on,
                r.replied ? 'Yes' : 'No', r.replied_on,
                r.score === null || r.score === undefined ? '' : r.score,
                r.comments
            ].map(quote).join(','));
        });

        function quote(v) {
            var s = v === null || v === undefined ? '' : String(v);
            return '"' + s.replace(/"/g, '""') + '"';
        }

        var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = stamped('csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };

    /**
     * Excel goes through the platform's own XLSX exporter rather than a file
     * assembled here, so the download is a real workbook and still obeys the
     * reader's access to the underlying records.
     */
    c.exportExcel = function() {
        if (!c.excelUrl || !c.rows().length) return;
        download(c.excelUrl, stamped('xlsx'));
    };

    /**
     * Both server-produced files come back with a download disposition, so
     * navigating a hidden link fetches them without leaving the report or
     * opening an empty tab.
     */
    function download(url, filename) {
        var link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename || '');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function stamped(extension) {
        return 'csat-survey-results-' + new Date().toISOString().slice(0, 10) + '.' + extension;
    }

    /**
     * The PDF is rendered server side because it carries the summary tiles and
     * breakdowns as well as the detail rows, which the browser cannot produce
     * without a print dialog.
     */
    c.exportPdf = function() {
        if (c.pdfBusy || !c.rows().length) return;
        c.pdfBusy = true;
        c.error = '';

        c.server.get(angular.extend({ action: 'pdf' }, c.filters)).then(function(r) {
            c.pdfBusy = false;
            var pdf = r.data.pdf;
            if (!pdf || pdf.error) {
                c.error = (pdf && pdf.error) || 'The PDF could not be generated.';
                return;
            }
            download(pdf.url, pdf.file_name);
        }, function() {
            c.pdfBusy = false;
            c.error = 'The PDF could not be generated. Please try again.';
        });
    };
};
