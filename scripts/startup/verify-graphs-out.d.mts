export interface GraphsOutVerificationResult {
	ok: boolean;
	errors: string[];
}

export function verifyGraphsOut(): GraphsOutVerificationResult;
