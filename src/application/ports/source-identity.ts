import type { SourceDigest } from "../../domain/session.js";

export interface SourceIdentityProvider {
	computeSourceDigest(): Promise<SourceDigest>;
}
