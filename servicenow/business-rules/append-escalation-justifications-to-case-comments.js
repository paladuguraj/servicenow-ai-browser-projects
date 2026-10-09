/**
 * Append Customer Justification / De-escalation Justification to the source
 * case Additional Comments (customer-visible external notes).
 */
(function executeRule(current, previous /*null when async*/) {
	var sourceTable = current.getValue('source_table');
	var sourceId = current.getValue('source_record');
	if (!sourceTable || !sourceId) return;
	if (sourceTable != 'sn_customerservice_case' && sourceTable != 'csm_order_case') return;

	var caseGr = new GlideRecord(sourceTable);
	if (!caseGr.get(sourceId)) return;
	if (!caseGr.isValidField('comments')) return;

	var notes = [];

	// Escalate: surface Customer Justification when the escalation is first created
	// (or when justification is first filled). Avoid re-posting on later state changes.
	var postCustomerJustification =
		!current.escalation_justification.nil() &&
		(current.operation() == 'insert' ||
			(current.escalation_justification.changes() && previous.escalation_justification.nil()));
	if (postCustomerJustification) {
		notes.push(gs.getMessage('Customer Justification: {0}', [current.getValue('escalation_justification')]));
	}

	// De-escalate (Closed Escalated): surface De-escalation Justification
	if (current.state.changes() && current.state == 103 && !current.de_escalation_justification.nil()) {
		notes.push(gs.getMessage('De-escalation Justification: {0}', [current.getValue('de_escalation_justification')]));
	}

	if (!notes.length) return;

	caseGr.comments = notes.join('\n');
	caseGr.update();
})(current, previous);
