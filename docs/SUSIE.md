# Susie under CityLife

Susie is a CityLife/Kooker capability, not a standalone Android application. The existing web,
TV and Android wrapper are display surfaces; archiving, repository retrieval, evidence assessment,
and task/operator actions belong behind authenticated backend boundaries.

## Trust boundaries

- Identity uses Authorization Code with PKCE. A public client receives only backend-minted,
  short-lived, audience-bound tokens. No inference credential, GitHub credential, signing key,
  cluster credential, or broad device permission is shipped to a CityLife client.
- Repository retrieval uses a GitHub App installed only on repositories the user approves. The
  minimum repository permission is **Contents: read-only**. Add **Metadata: read-only** (implicit for
  GitHub Apps). Add **Pull requests: read-only** or **Issues: read-only** only if answers must cite
  those objects. Do not request Administration, Actions, Checks, Deployments, Members, Secrets,
  Workflows, or any write permission. Mint installation tokens server-side and never persist them in
  the browser or APK.
- The evidence ledger is append-only. User-provided material can be archived as `uncertain`; a claim
  becomes `verified` only with repository, immutable revision, path, and optional line citations.
- Display clients accept only `citylife.susie.visual.v1` allowlisted templates with evidence IDs and
  expiry. They return only `rendered`, `understood`, or `misunderstood`. URLs, HTML, file paths,
  intents, device commands, and generation payloads are outside the contract.
- Cluster deployment, epic/task mutation, and review handoff are distinct operator capabilities.
  They require verified credentials plus explicit user-authorized scopes. This source slice grants
  none of them and does not contact Mo-Jo-Joe.

## Current delivery shape

`src/susie/evidence.ts` defines the evidence record and append-only persistence boundary.
`src/susie/visualContract.ts` defines the strict display request and acknowledgement boundary.
Concrete persistence, GitHub App installation identifiers, OAuth endpoints, token issuer/audience,
cluster namespace, task system, and visual transport remain deployment-specific and must be selected
from verified operator configuration rather than guessed in this public repository.

## Production Kooker HQ acceptance gate

The commercial district and first-person walking code do not prove that Kooker HQ is enterable in
production. Release acceptance requires a real authenticated session at the authoritative CityLife
production URL and retained evidence for this exact sequence:

1. sign in through the production Kooker gate;
2. enter the production commercial plot;
3. walk an owned avatar to the Kooker headquarters;
4. enter through the headquarters boundary;
5. walk through the interior; and
6. exit without corrupting the session or city state.

Until that flow is exercised in the actual interface, every headquarters reachability/interior claim
is **unverified**.
