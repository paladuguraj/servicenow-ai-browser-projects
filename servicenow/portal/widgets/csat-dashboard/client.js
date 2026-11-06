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

    // Exports follow the dashboard as last loaded, not unapplied filter edits.
    function appliedParams(action) {
        var d = c.data.dashboard;
        return {
            action: action,
            program: d.program.id,
            range: d.range.id,
            from: d.range.from,
            to: d.range.to,
            survey: d.survey
        };
    }

    function fileName(extension) {
        return 'survey-dashboard-' + c.data.dashboard.program.id + '-' + new Date().toISOString().slice(0, 10) + '.' + extension;
    }

    function saveBlob(blob, name) {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(link.href); }, 1000);
    }

    function fetchRows() {
        c.exporting = true;
        c.error = '';
        return c.server.get(appliedParams('export')).then(function(response) {
            c.exporting = false;
            return response.data.export;
        }, function() {
            c.exporting = false;
            c.error = 'The export could not be prepared. Please try again.';
            return null;
        });
    }

    function surveyTable(result) {
        var header = ['Survey number', 'Survey', 'Account', 'From', 'Sent to', 'Status', 'Sent on', 'Due on', 'Responded', 'Taken on']
            .concat(result.questions);
        var rows = result.rows.map(function(r) {
            return [r.number, r.survey, r.account, r.source, r.user, r.state, r.sent_on, r.due_on,
                r.responded ? 'Yes' : 'No', r.taken_on].concat(result.questions.map(function(q) {
                return r.answers[q] || '';
            }));
        });
        return [header].concat(rows);
    }

    function truncatedNote(result) {
        if (result.truncated)
            c.notice = 'Only the latest ' + result.limit + ' surveys were exported. Narrow the date range to export the rest.';
    }

    c.exportCsv = function() {
        if (c.exporting) return;
        c.notice = '';
        fetchRows().then(function(result) {
            if (!result) return;
            var lines = surveyTable(result).map(function(row) {
                return row.map(function(v) {
                    var s = v === null || v === undefined ? '' : String(v);
                    return '"' + s.replace(/"/g, '""') + '"';
                }).join(',');
            });
            // The byte order mark makes Excel read the file as UTF-8.
            saveBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }), fileName('csv'));
            truncatedNote(result);
        });
    };

    c.exportExcel = function() {
        if (c.exporting) return;
        c.notice = '';
        fetchRows().then(function(result) {
            if (!result) return;
            var d = c.data.dashboard;
            var summary = [
                ['Survey Management Dashboard', d.program.label],
                ['Period', d.range.from ? d.range.from + ' to ' + d.range.to : 'All time'],
                ['Survey', d.surveyName],
                ['Generated', new Date().toLocaleString()],
                [],
                ['Surveys sent', d.summary.sent],
                ['Responses received', d.summary.responded],
                ['Response rate %', d.summary.responseRate],
                ['Awaiting response', d.summary.pending],
                ['Cancelled / expired', d.summary.cancelled],
                [],
                ['Period', 'Sent', 'Responses']
            ];
            d.trend.buckets.forEach(function(b) { summary.push([b.label, b.sent, b.responded]); });
            summary.push([], ['Survey', 'Sent', 'Responses', 'Response rate %']);
            d.bySurvey.forEach(function(s) { summary.push([s.name, s.sent, s.responded, s.responseRate]); });
            d.questions.forEach(function(q) {
                summary.push([], [q.name + ' (' + q.survey + ')', 'Count', '%', 'Average', q.average === null ? '' : q.average]);
                q.options.forEach(function(o) { summary.push([o.label, o.count, o.percent]); });
            });

            var blob = buildXlsx([
                { name: 'Summary', rows: summary },
                { name: 'Surveys', rows: surveyTable(result) }
            ]);
            saveBlob(blob, fileName('xlsx'));
            truncatedNote(result);
        });
    };

    // Rendered on the server because it carries the charts and breakdowns,
    // which the browser cannot turn into a PDF without a print dialog.
    c.exportPdf = function() {
        if (c.exporting) return;
        c.exporting = true;
        c.error = '';
        c.notice = '';
        c.server.get(appliedParams('pdf')).then(function(response) {
            c.exporting = false;
            var pdf = response.data.pdf;
            if (!pdf || pdf.error) {
                c.error = (pdf && pdf.error) || 'The PDF could not be generated.';
                return;
            }
            var link = document.createElement('a');
            link.href = pdf.url;
            link.setAttribute('download', pdf.file_name);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }, function() {
            c.exporting = false;
            c.error = 'The PDF could not be generated. Please try again.';
        });
    };

    /**
     * A minimal .xlsx: one worksheet per sheet, inline strings, numbers kept
     * numeric, packed in an uncompressed zip. Built here because the platform
     * exporter can only export fields of one table, not the account or the
     * answers.
     */
    function buildXlsx(sheets) {
        function xml(v) {
            return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        function column(i) {
            var name = '';
            for (i++; i > 0; i = Math.floor((i - 1) / 26))
                name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
            return name;
        }
        function sheetXml(rows) {
            var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
            rows.forEach(function(row, r) {
                out.push('<row r="' + (r + 1) + '">');
                row.forEach(function(v, i) {
                    if (v === null || v === undefined || v === '') return;
                    var ref = column(i) + (r + 1);
                    if (typeof v === 'number' && isFinite(v))
                        out.push('<c r="' + ref + '"><v>' + v + '</v></c>');
                    else
                        out.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>');
                });
                out.push('</row>');
            });
            out.push('</sheetData></worksheet>');
            return out.join('');
        }

        var files = [
            ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                sheets.map(function(s, i) {
                    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
                }).join('') + '</Types>'],
            ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>'],
            ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
                sheets.map(function(s, i) {
                    return '<sheet name="' + xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
                }).join('') + '</sheets></workbook>'],
            ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                sheets.map(function(s, i) {
                    return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
                }).join('') + '</Relationships>']
        ];
        sheets.forEach(function(s, i) {
            files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows)]);
        });
        return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function zip(files) {
        var encoder = new TextEncoder();
        var table = [];
        for (var n = 0; n < 256; n++) {
            var k = n;
            for (var b = 0; b < 8; b++) k = k & 1 ? 0xEDB88320 ^ (k >>> 1) : k >>> 1;
            table[n] = k >>> 0;
        }
        function crc32(bytes) {
            var crc = 0xFFFFFFFF;
            for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }
        function header(size) {
            var bytes = new Uint8Array(size);
            return { bytes: bytes, view: new DataView(bytes.buffer) };
        }

        var parts = [];
        var central = [];
        var offset = 0;
        files.forEach(function(file) {
            var name = encoder.encode(file[0]);
            var data = encoder.encode(file[1]);
            var crc = crc32(data);

            var local = header(30);
            local.view.setUint32(0, 0x04034b50, true);
            local.view.setUint16(4, 20, true);
            local.view.setUint16(6, 0x0800, true);
            local.view.setUint32(14, crc, true);
            local.view.setUint32(18, data.length, true);
            local.view.setUint32(22, data.length, true);
            local.view.setUint16(26, name.length, true);
            parts.push(local.bytes, name, data);

            var entry = header(46);
            entry.view.setUint32(0, 0x02014b50, true);
            entry.view.setUint16(4, 20, true);
            entry.view.setUint16(6, 20, true);
            entry.view.setUint16(8, 0x0800, true);
            entry.view.setUint32(16, crc, true);
            entry.view.setUint32(20, data.length, true);
            entry.view.setUint32(24, data.length, true);
            entry.view.setUint16(28, name.length, true);
            entry.view.setUint32(42, offset, true);
            central.push(entry.bytes, name);

            offset += 30 + name.length + data.length;
        });

        var centralSize = central.reduce(function(sum, part) { return sum + part.length; }, 0);
        var end = header(22);
        end.view.setUint32(0, 0x06054b50, true);
        end.view.setUint16(8, files.length, true);
        end.view.setUint16(10, files.length, true);
        end.view.setUint32(12, centralSize, true);
        end.view.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [end.bytes]));
    }

    syncFilters();
};
