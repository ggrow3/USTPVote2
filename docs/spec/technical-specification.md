> Plain-text extraction of `USTP-Standalone-Technical-Specification.docx` (same folder) for diffing and
> search. The `.docx` is authoritative; list nesting was flattened during extraction.

# USTP Standalone Voter Registration & Voting System: Architectural Design & Technical Specification

Organization: United States Transhumanist Party (USTP)
Architecture: Standalone Single-Project Application (ustp-voting-system)
Target Stack: Node.js 26 LTS (TypeScript, NestJS on Fastify), Vue 3 + Quasar 2 SPA/PWA, Google Cloud Platform (Cloud Run, Cloud Firestore, Cloud KMS, Cloud Storage Bucket Lock, Identity Platform, Cloud Vision)

## 1. Executive Summary & Scope

The USTP Voter Registration & Voting System is a unified, standalone web application running inside a single Google Cloud project. It manages voter registration, portable identity management, proposal snapshots, and cryptographically verifiable organizational elections.

### 1.1 In-Scope Capabilities (V1)

Voter Registration & Lifecycle: Applicant onboarding (/register), bylaws agreement, Membership Admin verification, append-only eligibility status history, and optional profile photo quality checks for voter verification.

Portable Account Architecture: USTP-minted UUIDv7 account identifiers decoupled from underlying OIDC logins (Google, Microsoft, Apple, Passwordless Email Link, and NIST SP 800-63B-4 Email/Password).

Multi-Contest Ballots: Simultaneous voting on platform/bylaw proposals and candidate/officer contests within a single voting window.

Voting Methods:

Proposal Voting: Yes / No / Abstain with configurable pass rules and quorums.

Non-Ranked Candidate Voting: Choose up to N (plurality, block, or approval voting) and Choose up to N with Support Floor.

Ranked-Choice Candidate Voting: Instant-Runoff Voting (IRV) for single-seat contests.

Secrecy Modes: Per-election configuration for Secret Ballots (using an atomic participation/pooled-ballot split and a $k$-anonymity pool mixer) or Open Roll-Call Ballots.

End-to-End Auditability: RFC 8785 JSON Canonicalization Scheme (JCS) hash chains, Merkle inclusion receipts, Cloud Storage Bucket Lock external anchoring, deterministic tallying via the public ustp-tally library, and two-person administrative sign-offs.

## 2. Single-Project Google Cloud Architecture

### 2.1 Unified GCP Project Topology

The entire application runs inside a single Google Cloud project per environment (ustp-voting-dev, ustp-voting-staging, ustp-voting-prod):

Frontend (web): Single Vue 3 + Quasar 2 SPA/PWA hosted on Firebase Hosting (serving /register, /ballot, /verify, and /admin routes).

Backend API (api): Single Node.js 26 LTS (NestJS on Fastify) service deployed on Google Cloud Run, handling voter registration and voting endpoints.

Background Worker (worker): Single Google Cloud Run Worker / Jobs service triggered by Cloud Scheduler and Cloud Tasks for ballot pool sealing, Bucket Lock anchoring, proposal snapshotting, and photo validation.

Database (db): Cloud Firestore (Standard Edition) utilizing the single project's free-tier database ((default)), structured into clear collection namespaces (registration and voting).

## 3. Voter Registration Module (registration Namespace)

USTP Account ID: UUIDv7 in accounts, linked to OIDC identities in account_identities. Voter rolls key exclusively by account_id.

Registration & Status History: Members register via /register, moving through Applicant, Active, Lapsed, Suspended, Resigned, or Rejected. Every change writes an immutable entry to member_status_history.

Profile Photo Verification: Cloud Vision checks for quality and SafeSearch without biometric identification. Only human Membership Admins can reject photos.

## 4. Voting & Election Module (voting Namespace)

Lifecycle States: Draft $\rightarrow$ Scheduled $\rightarrow$ Open $\rightarrow$ Closed $\rightarrow$ Certified.

Roll Snapshots: KMS-signed eligibility snapshots verified and co-approved by an Election Admin and an Auditor.

Ballot Secrecy & Sealer: Atomic participation/pooled-ballot split (transaction.create()) combined with a batch sealer (sealed_blocks/{blockIndex}) that strips Firestore microsecond timestamps to ensure complete voter-ballot unlinkability.

External Anchoring: 1-minute cryptographic anchors written to Google Cloud Storage with Bucket Lock (WORM storage).

## 5. Administrative Section & Separation of Duties

Role Matrix: Membership Admin, Election Admin, Auditor, and System Admin.

Two-Person Rules: Roll approvals, election certification, and officer position modifications require distinct co-signers (approver != requester).

Admin Modules: Vue 3 + Quasar 2 administrative console at /admin covering registration triage, election setup, audit checks, and auth switches.

## 6. Consolidated Data Model & API Surface

### 6.1 Firestore Collections (Single Default Database)

registration Namespace: accounts, account_identities, account_factors, sign_in_methods, members, member_status_history, applications, profile_photos, photo_checks, positions, position_terms, eligibility_snapshots.

voting Namespace: elections, contests, candidates, roll_entries, proposal_snapshots, proposal_reviews, participation, ballot_pool, sealed_blocks, blocks, anchors, results, role_assignments, audit_events.

## 7. Security, Verification & Launch Gates

Firestore Security Rules & App Check: Deny all direct client reads/writes (allow read, write: if false;), forcing traffic through the NestJS Cloud Run API with Firebase App Check.

Metadata Sanitization: Eradicating createTime via batched block sealing.

Binary Authorization: Reproducible builds via locked dependencies (npm ci --ignore-scripts).

## 8. Estimated Monthly Infrastructure Cost

| GCP Service | Free Tier Included (Per Project) | Estimated Monthly Usage (1,000 – 5,000 Members) | Monthly Cost |
|---|---|---|---|
| Cloud Firestore ((default) DB) | • 1 GiB stored data / • 50,000 doc reads/day /  / • 20,000 doc writes/day | • Storage: ~50 MB /  / • Reads/Writes: ~10,000 writes & ~30,000 reads during peak voting days (within free daily quota). | $0.00 / mo |
| Cloud Storage + Bucket Lock | • 5 GB-months Standard storage / • 5,000 Class A writes/mo /  / • Bucket Lock feature: Free ($0.00) | • Storage: < 50 MB /  / • Smart Anchoring: Writes new anchors only when audits/blocks change (< 5,000 writes/mo). | $0.00 / mo |
| Cloud Run (API + Worker) | • 2 million requests/mo /  / • 180,000 vCPU-seconds free/mo | Scales to zero when idle; fully covers routine voter traffic and worker batch jobs. | $0.00 / mo |
| Firebase Hosting | • 10 GB stored /  / • 360 MB/day transfer | Serves the Vue 3 + Quasar 2 SPA/PWA frontend. | $0.00 / mo |
| Identity Platform | • 50,000 Monthly Active Users (MAU) | Covers Google, Microsoft, Apple, Email Link, and Password sign-ins with MFA. | $0.00 / mo |
| Google Cloud KMS | • Asymmetric signing operations | 1 key version ($0.06/mo) + low-volume signing for rolls, receipts, and certified bundles. | ~$0.09 / mo |
| Google Cloud Secret Manager | • First 6 secret versions & 10,000 accesses/mo | Stores PRNG tie-break seed and SES credentials. | $0.00 / mo |
| Cloud Vision API | • First 1,000 images/mo free | Profile photo quality checks ($\sim 10%$ member photo uploads/updates per month). | $0.00 / mo |
| Amazon SES (Transactional Email) | • Outbound mail delivery | Registration notices and "you voted" receipts ($0.10 per 1,000 emails). | ~$0.20 – $0.50 / mo |
| Total Estimated Monthly Bill | Unified Standalone Application |  | ~$0.29 – $0.59 / month |

## 9. LLM Evaluation: Consistency Against Principles & Constitution

This section provides an automated LLM evaluation of the system architecture against core governance principles and the United States Constitution:

Popular Sovereignty & Republicanism:

Evaluation: Fully Consistent. The system implements direct democratic participation for members via secure ballots, while maintaining structured representative governance through elected officer positions (position_terms) and quorum-enforced proposal thresholds.

Separation of Powers & Checks and Balances:

Evaluation: Fully Consistent. The architecture structurally enforces separation of duties across administrative roles (Membership Admin, Election Admin, Auditor, System Admin) and requires two independent actors (e.g., Election Admin + Auditor) to co-sign critical state transitions like roll approvals and election certifications.

Due Process & Equal Protection (U.S. Constitution, 5th & 14th Amendments):

Evaluation: Fully Consistent. Every voter on the frozen roll receives equal voting weight, atomic duplicate-vote protection (transaction.create()), receipt tracking via Merkle proofs, and mandatory written reasons for any registration/membership status change or rejection.

Limited Government & Privacy Protections (4th Amendment Principles):

Evaluation: Fully Consistent. The architecture minimizes data collection, discards street addresses after district lookup, splits participation from pooled ballots to maintain voter privacy, and relies on cryptographic anchoring rather than broad surveillance or tracking.