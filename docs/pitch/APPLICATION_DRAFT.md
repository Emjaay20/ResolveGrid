# ResolveGrid - Pitch Application Draft

## One-line summary

ResolveGrid converts ambiguous Nigerian location descriptions into source-aware digital postcodes, dispatch-ready routes and consented last-mile field evidence.

## Problem

In Nigeria, a delivery, utility or emergency worker can have a phone number and a familiar landmark yet still lose valuable time locating the right gate, building or access route. The resulting delays increase failed deliveries, field-service costs and response times.

## Solution

ResolveGrid uses Nigeria's digital postcode system as the location backbone. It resolves a natural-language address into a standardised address and postcode, shows the origin and confidence of that result, ranks suitable available agents for a dispatch task, and lets a provisioned field agent capture consented GPS and last-mile access observations.

## Why it matters

The same building-level location infrastructure can help logistics, e-commerce, utilities, property services, emergency response and financial KYC operations. Every verified field observation can make later visits clearer without silently overwriting trusted address records.

## What is live

- Public operations console deployed on AetherHost.
- Mobile Expo field workflow with provisioned sign-in.
- Source-aware NIPOST integration layer.
- MySQL-backed field accounts and append-only evidence records.
- Redis-supported dispatch coordination.

## Responsible AI statement

ResolveGrid does not claim a trained predictive model yet. It currently uses an explainable ETA baseline plus online residual learning from consented, verified arrival data. Funding would support a governed Nigerian last-mile dataset, independent evaluation and a versioned production ETA model.

## Ask

We seek NIPOST staging/production support, pilot partners in logistics or field operations, and funding to validate the solution across real addresses while preserving consent, data provenance and auditability.
