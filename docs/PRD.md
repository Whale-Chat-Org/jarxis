# Jarxis Product Requirements

## 1. Product summary

Jarxis is a secure administration starter for products that need account authentication, account
settings, role-based access control, user administration, audit visibility, and a small API token
surface. It provides production-oriented foundations while leaving domain-specific business
features to the adopting product.

This document describes the product currently implemented in the repository. Technical design and
module ownership are documented in [TECH.md](TECH.md).

## 2. Problem statement

Product teams repeatedly need the same security-sensitive foundations before they can build their
actual application: verified accounts, password recovery, secure sessions, API authentication,
administrative roles, protected owner operations, and audit records. Implementing these pieces ad
hoc creates inconsistent user experiences and avoidable authorization risks.

Jarxis supplies these foundations as one coherent application with deny-by-default permissions and
clear extension points.

## 3. Goals

- Let a person register, verify an email address, sign in, recover a password, and manage an
  account without administrator assistance.
- Give authorized operators a usable administration area for users, sessions, roles, permissions,
  and audit events.
- Protect privileged operations with server-side, database-backed authorization on every request.
- Support non-browser clients with short-lived access tokens and rotating refresh tokens.
- Provide a local development and container deployment path backed by PostgreSQL, Redis, and Brevo transactional email.
- Remain a focused starter that can be extended with product-specific features.

## 4. Users and roles

| Persona            | Need                                                        | Jarxis role                  |
| ------------------ | ----------------------------------------------------------- | ---------------------------- |
| Account holder     | Register, authenticate, and manage their own account        | `user`                       |
| Read-only operator | Inspect administration data without changing it             | `viewer`                     |
| Administrator      | Manage ordinary users and their sessions                    | `administrator`              |
| Product owner      | Perform all administrative operations and assign roles      | `owner`                      |
| API client         | Authenticate without a browser and maintain a token session | Any active, verified account |

A new account receives the `user` role and no administrative access. The four system roles are
declared in code; owners can add custom roles from the permission catalog. Unknown stored role
names grant no permissions.

## 5. Product scope

### 5.1 Public experience

- A public landing page presents the Jarxis identity and sign-in/sign-up actions.
- The public header supports theme switching.
- Authentication and public pages share consistent header and footer chrome.
- Loading states preserve the final page layout and avoid navigation shifts.

### 5.2 Authentication

- A person can sign up with name, email, and password.
- The account must verify its email before normal authenticated use.
- A person can sign in and sign out with an HttpOnly cookie session.
- Forgot-password and reset-password flows deliver links through the configured Brevo account.
- Authentication failures use safe messages and do not expose internal errors or credentials.
- Rate limiting protects authentication and token issuance paths.
- A fresh deployment can create its first owner from the public `/setup` page, with no setup secret
  and no shell access. Anyone may open the page while no owner exists; it asks for name, email and
  password, accepts any address, and emails a six-digit owner code to it. The candidate account
  remains unverified with no administrative privileges until the code is verified.
- The owner code is 6 digits, expires after 10 minutes, allows 5 attempts, and can be resent after
  a 60-second cooldown; a resend replaces the expiry and invalidates the previous code. Codes are
  stored hashed. Expired, invalid and exhausted codes get clear messages, and a failed email
  delivery is stated plainly with a resend option.
- The first successful verification wins atomically, so concurrent attempts leave exactly one
  owner; `/setup` then reports completion and links to sign-in permanently. Every ordinary sign-up
  still verifies by email, and the `pnpm owner` command is retained as CLI recovery without being
  required for bootstrap.

### 5.3 Account settings

- An authenticated account holder can update profile information and avatar.
- An account holder can change email and password.
- An account holder can inspect and revoke active sessions.
- An account holder can change appearance settings.

### 5.4 Administration

- Authorized users can open an administration dashboard with user, role, permission, and recent
  audit information.
- Viewers can inspect users, roles, permissions, and audit records.
- Administrators can create and update ordinary users, ban or unban them, set passwords and email
  addresses, and inspect or revoke their sessions.
- Owners can additionally assign roles, delete users, and perform owner-level impersonation.
- Owners can create, edit, duplicate and delete custom roles; system roles stay locked, and a role
  that users still have cannot be deleted.
- Administration navigation is responsive and usable on desktop and mobile viewports.

### 5.5 Owner safety rules

- Only an owner can modify another owner or grant the `owner` role.
- An owner role can be granted only to an active, verified account.
- The last active, verified owner cannot be demoted, banned, deleted, or stripped of sessions.
- Banning an account revokes its browser sessions and API token families.
- Successful administrative mutations produce audit events with allowlisted details and no secrets.

### 5.6 API clients and documentation

- A verified account can exchange email/password credentials for an access and refresh token pair.
- An access token expires after 10 minutes.
- A refresh token is single-use, rotates on refresh, and belongs to a family with an absolute
  30-day lifetime capped by its backing session.
- Reuse of a consumed refresh token revokes its entire token family.
- A client can revoke its current token family through logout.
- `GET /api/v1/me` resolves the authenticated user and session from a bearer token or cookie.
- OpenAPI JSON and an interactive API reference are available to owners outside development.

## 6. Authorization matrix

| Capability                                | User | Viewer | Administrator | Owner |
| ----------------------------------------- | :--: | :----: | :-----------: | :---: |
| Manage own account                        | Yes  |  Yes   |      Yes      |  Yes  |
| View administration dashboard             |  No  |  Yes   |      Yes      |  Yes  |
| View users, roles, permissions, and audit |  No  |  Yes   |      Yes      |  Yes  |
| Create or update ordinary users           |  No  |   No   |      Yes      |  Yes  |
| Ban users and manage their sessions       |  No  |   No   |      Yes      |  Yes  |
| Assign roles                              |  No  |   No   |      No       |  Yes  |
| Delete users or manage owners             |  No  |   No   |      No       |  Yes  |

Page visibility is not an authorization boundary. Each page and endpoint must independently enforce
the permissions required for its action.

## 7. Non-functional requirements

### Security

- Cookie-authenticated mutations reject foreign origins.
- Secrets, passwords, raw tokens, request bodies, and SQL parameters must not appear in logs or
  audit payloads.
- Access token claims are never the authority for current permissions; current database state is
  checked on each API request.
- PostgreSQL and Redis failures fail authentication and authorization closed.
- Production requires HTTPS and distinct cryptographically random authentication and JWT secrets.
- The application runs as a non-root user in its production container.

### Accessibility and experience

- Interactive controls are keyboard operable and use accessible names.
- UI uses semantic design tokens and supports light and dark themes.
- Pages provide route-appropriate loading and error states.
- Administrative navigation adapts to narrow viewports.

### Reliability and operability

- `/api/health` reports PostgreSQL and Redis health.
- Database migrations complete before the application starts.
- Audit records are queryable in reverse chronological order.
- Production data can be backed up and restored with standard PostgreSQL tooling.

## 8. Out of scope

- Multi-tenancy, organizations, or per-resource ownership rules.
- Creation of new permission keys at runtime and permissions.
- Social sign-in providers, MFA, passkeys, or enterprise SSO.
- Billing, subscriptions, or product-specific business workflows.
- Automated database rollback or down-migrations.
- Automatic cleanup of expired token-family replay evidence.

## 9. Acceptance criteria

Jarxis is ready for use as a starter when:

1. A new person can register, verify through email, sign in, recover a password, and manage account
   settings.
2. A fresh account cannot access administration routes or operations.
3. First-run setup emails a six-digit code to an unverified candidate account, grants Owner only
   after verification, and closes permanently after exactly one winner. Invalid, expired and reused
   codes cannot grant access; CLI recovery remains available.
4. Viewer, administrator, and owner behavior matches the authorization matrix.
5. Owner safety rules prevent removal of the final active, verified owner.
6. Browser sessions and rotating API tokens can be issued and revoked, and refresh-token replay
   revokes the affected family.
7. Administrative mutations generate sanitized audit records.
8. Health, OpenAPI, and API reference endpoints enforce their documented access behavior.
9. Lint, formatting, type checks, unit tests, relevant database integration tests, production build,
   and browser acceptance tests pass in an isolated test environment.

## 10. Success indicators

- A team can start local development from [DEVELOPMENT.md](DEVELOPMENT.md) without undocumented setup.
- No administrative capability is reachable by a role that lacks its declared permission.
- No critical authentication, authorization, or secret-exposure defects are open.
- Core user journeys are covered by automated unit, integration, and browser tests.
- Product-specific modules can be added without replacing authentication, RBAC, or deployment
  foundations.
