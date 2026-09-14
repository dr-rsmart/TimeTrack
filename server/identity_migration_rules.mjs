/** Pure rules shared by identity preflight/resolution scripts and tests. */

export function normalizeIdentityEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function classifyIdentityCandidates({ sourceTenantId, candidates, allEmailMatches }) {
  const validCandidates = candidates.filter(
    (candidate) => sourceTenantId == null || candidate.companyProfileId === sourceTenantId,
  );

  if (validCandidates.length === 1) return 'eligible';
  if (validCandidates.length > 1) return 'ambiguous';
  if (allEmailMatches.length > 0) return 'cross_tenant';
  return 'unmatched';
}

export function validateResolutionMapping({ source, target, mapping }) {
  const errors = [];
  const sourceEmail = normalizeIdentityEmail(source.employeeEmail);
  const mappedSourceEmail = normalizeIdentityEmail(mapping.sourceEmail);
  const targetEmail = normalizeIdentityEmail(target.email);
  const mappedTargetEmail = normalizeIdentityEmail(mapping.targetEmail);

  if (source.employeeId != null) errors.push('source row already has employeeId');
  if (!mapping.employeeId || mapping.employeeId !== target.id) errors.push('employeeId does not match target employee');
  if (!mappedSourceEmail || mappedSourceEmail !== sourceEmail) errors.push('sourceEmail does not match the current source row');
  if (!mappedTargetEmail || mappedTargetEmail !== targetEmail) errors.push('targetEmail does not match the target employee');
  if (!mapping.approvedBy || String(mapping.approvedBy).trim().length < 2) errors.push('approvedBy is required');
  if (!mapping.reason || String(mapping.reason).trim().length < 5) errors.push('reason must be at least 5 characters');
  if (source.companyProfileId != null && target.companyProfileId !== source.companyProfileId) {
    errors.push('target employee belongs to a different tenant');
  }
  if (source.companyProfileId == null && !mapping.companyProfileId) {
    errors.push('companyProfileId approval is required for a source row without tenant identity');
  }
  if (mapping.companyProfileId && target.companyProfileId !== mapping.companyProfileId) {
    errors.push('approved companyProfileId does not match target employee tenant');
  }

  return { valid: errors.length === 0, errors };
}