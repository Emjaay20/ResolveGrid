# ResolveGrid Live Demo Runbook

## Goal

Show how an ambiguous Nigerian location becomes a traceable, dispatch-ready address and how a field worker can capture consented last-mile evidence.

## Before presenting

1. Confirm the public web app opens.
2. Confirm the mobile app can sign in with the provisioned field account.
3. Confirm the server health endpoint reports MySQL and Redis as connected.
4. Use a NIPOST result that is labelled as an official staging or production response. Do not submit real evidence against a development fixture.

## Two-minute flow

1. Open the **Resolve** view and paste a natural-language location or landmark.
2. Point out the standardised address, digital postcode, confidence and source label.
3. Create a dispatch task. Explain that ResolveGrid ranks available network agents using route, weather and access conditions.
4. On the mobile app, sign in as a provisioned field agent.
5. Enter the verified postcode, capture GPS only with consent, enter gate delay and an access note, then submit.
6. Close by explaining that field evidence is append-only and subject to review before it improves trusted building intelligence.

## If the official NIPOST environment is unavailable

Demonstrate resolution and dispatch using the development fixture, explicitly call it a development fixture, and stop before field-evidence submission. Never represent fixture data as an official verification.
