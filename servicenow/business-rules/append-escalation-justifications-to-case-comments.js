/**
 * Append Customer Justification / De-escalation Justification to the source
 * case Additional Comments (customer-visible external notes).
 *
 * Customer Justification is posted only once. OOB EscalationUtils.appendNote()
 * does a nested escalation.update() for work notes during the same escalate
 * transaction; without a guard that re-fires this rule and duplicates the note.
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

	/**
	 * True when this transaction already posted a given marker to case comments.
	 * Prevents duplicates when OOB rules nest an escalation.update().
	 */
	function alreadyPosted(marker) {
		if (!marker) return false;
		var j = new GlideRecord('sys_journal_field');
		j.addQuery('element_id', sourceId);
		j.addQuery('element', 'comments');
		j.addQuery('value', 'CONTAINS', marker);
		j.setLimit(1);
		j.query();
		return j.hasNext();
	}

	// Escalate: post Customer Justification once when first set (insert, or
	// empty -> value). Skip re-entry from nested escalation updates.
	var justification = current.getValue('escalation_justification');
	var justificationFirstSet =
		justification &&
		(current.operation() == 'insert' ||
			(current.escalation_justification.changes() &&
				(previous.escalation_justification.nil() || previous.getValue('escalation_justification') == '')));

	if (justificationFirstSet) {
		var custMarker = 'Customer Justification: ' + justification;
		if (!alreadyPosted(custMarker) && !alreadyPosted(justification)) {
			notes.push(gs.getMessage('Customer Justification: {0}', [justification]));
		}
	}

	// De-escalate (Closed Escalated): post De-escalation Justification once
	if (current.state.changes() && current.state == 103 && !current.de_escalation_justification.nil()) {
		var deJust = current.getValue('de_escalation_justification');
		var deMarker = 'De-escalation Justification: ' + deJust;
		if (!alreadyPosted(deMarker) && !alreadyPosted(deJust)) {
			notes.push(gs.getMessage('De-escalation Justification: {0}', [deJust]));
		}
	}

	if (!notes.length) return;

	caseGr.comments = notes.join('\n');
	caseGr.update();
})(current, previous);
