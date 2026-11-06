// LIFEOS-API-001 section 7. The shape every future integration adapter takes. No provider is implemented yet.
//
// An adapter never receives a raw credential from a caller. It resolves `credentialRef` against a secret store,
// and it receives only records the principal could read through the service.

export type IntegrationEvent = { seq: number; eventType: string; eventVersion: number; entityType: string; entityId: string };

export interface IntegrationAdapter {
  /** A stable provider key, such as "google_calendar". */
  readonly provider: string;
  /** Scopes the person is asked to approve, and nothing more. */
  readonly requiredScopes: readonly string[];
  /** Reacts to one audit-log event. Events carry no content, so it reads the record through the API. */
  handleEvent(connectionId: string, event: IntegrationEvent): Promise<void>;
  /** Revokes access at the provider. Called when the connection is revoked. */
  revoke(connectionId: string): Promise<void>;
}
