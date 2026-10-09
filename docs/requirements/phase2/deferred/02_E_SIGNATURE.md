> **DEFERRED 2026-10-09:** Jomerson put e-signature on hold ("forget the e-signature for now"). It's not in Phase 2 scope. This research is kept for reference only, and prices should be re-checked if it's revived. Phase 1 documents remain upload-only (Q-20).

# 02 · In-app E-signature (Phase 2 research draft)

## 1. Goal
Phase 1 stores documents that were signed outside the app (Q-20). Phase 2 would let a user send a document from the project's Documents area for signature, to internal users **and client contacts**, and have the signed PDF and its audit certificate saved back automatically as the locked Signed version (FR-DOC-30/31).

Client contacts still never get an account. They sign through the provider's emailed link, so the provider handles their identity check, not our app. This keeps BR-05 intact.

## 2. Legal basis in the Philippines (summary, not legal advice)
- [RA 8792, the E-Commerce Act of 2000](https://lawphil.net/statutes/repacts/ra2000/ra_8792_2000.html), Sec. 8: an electronic signature equals a handwritten one if it's proved that a procedure existed, not alterable by the parties, that identifies the signer, shows their approval, and lets the other party verify it. Sec. 16: contracts can't be denied validity just because they're electronic.
- The [IRR (DTI)](https://ecommerce.dti.gov.ph/wp-content/uploads/2020/11/IRR-of-RA-8792-E-Commerce-Act-of-2000.pdf) keeps any form a law requires, such as notarization or solemn contracts. Those documents still need the traditional process (or electronic notarization rules).
- **What this means for us:** the provider must give a tamper-evident signed PDF and an audit trail (signer email, IP, timestamps, and the identity method). We store both. Notarized documents stay as "upload a signed copy".

Confirm with Xceler8's legal counsel before relying on this for client contracts.

## 3. Provider comparison (API plans, prices checked 2026-10-09)
Sources: [Contract Flash e-signature API pricing summary (Aug 2026)](https://contractflash.com/blog/e-signature-api-pricing), [Docusign developer plans](https://ecom.docusign.com/plans-and-pricing/developer), [Dropbox Sign API pricing](https://sign.dropbox.com/products/dropbox-sign-api/pricing), [BoldSign API pricing](https://boldsign.com/electronic-signature-pricing/?plan=api).

| Provider | API entry price | Included | Beyond the allowance | Notes |
|----------|----------------|----------|----------------------|-------|
| **BoldSign** | $30/mo minimum | 40 envelopes | $0.75 per envelope | Free sandbox (watermarked test documents, deleted after 14 days). One envelope can hold up to 50 recipients and many files |
| **Docusign** (Developer Starter) | $50/mo | 40 envelopes | Quoted by sales | The best-known brand and widely accepted by enterprise clients. Intermediate is $300/mo for 100 envelopes |
| **Dropbox Sign** API (Essentials) | $75/mo | 50 requests | Quoted by sales | Clean API. Standard is $250/mo for 100 requests |
| **SignWell** | Free tier (3 API docs a month) | Up to 25 free docs a month depending on tier | From $0.85 down to $0.20 per doc | Cheap at low volume |
| **Documenso** | $25/mo cloud, or self-hosted | Unlimited documents | Included | Open source (AGPL-3.0). Self-hosting means we run and secure it |
| **Adobe Acrobat Sign** | Not publicly listed | – | – | Enterprise sales only |

## 4. Recommendation
1. **Build a provider-neutral integration.** Use an internal `SignatureProvider` interface with `createEnvelope`, `getStatus`, `downloadSigned`, `downloadAuditTrail`, `cancel`, and a webhook handler. Changing providers later then only means adding a new adapter.
2. **Pilot with BoldSign.** It has the lowest published cost at our likely volume (tens of contracts a month), a free sandbox for Deven and Queen, and flat per-envelope pricing.
3. **Keep Docusign as the option for clients who require it.** Add it as a second adapter only if a client insists.

| Volume per month | BoldSign | Docusign Starter |
|-----------------|----------|------------------|
| 20 envelopes | $30 | $50 |
| 60 envelopes | $30 + 20 × $0.75 = $45 | Over the 40 included, so a sales-quoted overage or the $300 tier |

## 5. Draft functional requirements
| ID | Requirement |
|----|-------------|
| FR-ESIG-01 | From a document's latest Submitted PDF version, a PM or member can choose **Send for signature**. They pick signers in order: internal users and/or client contacts with an email on file, plus an optional message and expiry (default 14 days). |
| FR-ESIG-02 | The document shows "Out for signature", with each signer's status (Sent, Viewed, Signed, Declined) updated by provider webhooks. The webhooks are signature-verified and idempotent. |
| FR-ESIG-03 | When everyone has signed, the system downloads the signed PDF and the audit certificate, stores them as a new **Signed** version (locked, with a checksum), and records each signer, time, and method as lifecycle events. |
| FR-ESIG-04 | A decline or expiry returns the document to Submitted, with the reason recorded. The sender can resend. |
| FR-ESIG-05 | The sender can cancel while the document is out for signature. The provider envelope is voided. |
| FR-ESIG-06 | The client contact signs through the provider's emailed link only. No account, session, or app link is created for them (BR-05). |
| FR-ESIG-07 | Only PDFs can be sent. DOCX files must be converted first (Q-ES-03). |
| FR-ESIG-08 | Provider API keys and webhook secrets are stored on the server only. |
| FR-ESIG-09 | Admin settings: turn e-signature on or off, pick the provider, and view usage and cost this month. |

Status addition: Submitted, then **Out for signature**, then Signed, with Declined or Expired returning to Submitted. This still never moves a Signed document backward (FR-DOC-22).

## 6. Open questions
| ID | Question | Proposed default |
|----|----------|------------------|
| Q-ES-01 | Roughly how many documents a month need signing? | Assume 20–60 |
| Q-ES-02 | Do any clients require a specific provider, like Docusign? | Pilot with BoldSign, with Docusign as a fallback adapter |
| Q-ES-03 | Should the app convert DOCX to PDF automatically before sending? | No in v1. Require a PDF upload |
| Q-ES-04 | Is extra signer identity checking needed, like an SMS code or ID check, for high-value contracts? | Email link only in v1, with an SMS code as an option |
| Q-ES-05 | This sends email to client contacts, which Phase 1 Q-02 ruled out. Is that OK when the provider sends it, for signing only? | Yes, provider-sent signing emails only |
| Q-ES-06 | Legal counsel sign-off on using e-signatures for client contracts? | Required before go-live |
