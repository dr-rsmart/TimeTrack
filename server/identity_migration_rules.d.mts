export function normalizeIdentityEmail(value: unknown): string;

export function classifyIdentityCandidates(input: {
  sourceTenantId: string | null;
  candidates: Array<{ id: string; companyProfileId: string | null }>;
  allEmailMatches: Array<{ id: string; companyProfileId?: string | null }>;
}): 'eligible' | 'ambiguous' | 'cross_tenant' | 'unmatched';

export function validateResolutionMapping(input: {
  source: {
    id: string;
    employeeId: string | null;
    employeeEmail: string;
    companyProfileId: string | null;
  };
  target: {
    id: string;
    email: string;
    companyProfileId: string | null;
  };
  mapping: {
    id: string;
    employeeId: string;
    sourceEmail: string;
    targetEmail: string;
    companyProfileId?: string;
    approvedBy: string;
    reason: string;
  };
}): { valid: boolean; errors: string[] };
