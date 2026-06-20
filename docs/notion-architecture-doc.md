# Smart Transaction Stack for Solana Pay Dispatcher

## Overview

This project builds a real-time transaction infrastructure stack for Solana that goes beyond "send and hope." It monitors the network live, detects the correct leader window, constructs and submits Jito bundles, tracks transaction lifecycle stages, and uses an AI agent to make recovery decisions when failures occur.

The system is designed for operational reliability, not just happy-path demos. It observes processed, confirmed, and finalized transitions from the network, logs each lifecycle step, and uses the live network context to decide whether to retry, refresh a blockhash, increase the tip, or abandon the payment.

---

## Why this system exists

On Solana, a transaction does not simply "appear" on-chain. It moves through a stack of network stages:

- leader scheduling
- Jito bundle ingestion
- block production
- confirmation propagation
- finalization

For production-grade payment infrastructure, those stages matter. A payment may be submitted, appear in the network, and still fail later due to blockhash expiry, insufficient tip placement, or a skipped leader window.

This stack is built to make those decisions measurable and explainable.

---

## Core goals

1. Observe Solana network events in real time
2. Submit transactions through Jito bundles at the right time
3. Track the lifecycle from submission to finalization
4. Detect and classify failures
5. Let an AI agent make recovery decisions based on live conditions
6. Persist a verifiable lifecycle log for judges and operators

---

## High-level architecture

```text
User / Dashboard
      │
      ▼
PayDispatcher Orchestrator
      │
   ┌──┼───────────────┐
   │  │               │
   ▼  ▼               ▼
Geyser Stream     Jito Bundle Engine    SQLite + Logs
Leader Detector    Tip Fetcher              Receipt Generator
Network Health     Bundle Constructor       Failure Tracker
Confirmation      Bundle Submitter         Agent Decisions
Listener
```

---

## Core components

### 1. Geyser streaming layer

The stack uses Yellowstone/Geyser subscriptions to observe slot and transaction activity in real time.

Responsibilities:

- subscribe to live slot updates
- monitor processed, confirmed, and finalized milestones
- expose stream-based confirmation events without relying only on polling
- support reconnect and backpressure handling

Why it matters:

- it allows the system to react faster than traditional RPC polling
- it provides a real-time view of network timing and confirmation behavior

### 2. Leader detection layer

The leader detector reads the epoch schedule and identifies upcoming Jito leader windows.

Responsibilities:

- fetch leader schedule data
- map slot offsets to absolute slots
- identify likely Jito leader windows
- emit leader events ahead of time so submission can be gated correctly

Why it matters:

- Jito bundles are only useful if they land in the right leader window
- missing a slot window can cause silent bundle drop or missed execution

### 3. Bundle construction layer

This layer builds the actual Jito bundle payload.

Responsibilities:

- construct payment and tip transactions
- use a recent confirmed blockhash
- create a bundle with the payment transaction plus a tip transaction
- keep transaction construction deterministic and replayable

Why it matters:

- proper blockhash handling is essential for timely submissions
- the bundle must be assembled with the same context that it will be submitted under

### 4. Dynamic tip layer

Tip logic is intentionally dynamic and based on recent live tip statistics rather than hardcoded values.

Responsibilities:

- fetch recent tip account data from the Jito block engine
- calculate tip size based on network health and attempt count
- avoid hardcoded tip values
- adapt retries based on observed conditions

Why it matters:

- fees must be competitive enough to land during congestion
- the system should be responsive to an evolving network state

### 5. Submission layer

The submission layer gates the actual bundle send to the Jito block engine.

Responsibilities:

- wait for an appropriate leader window
- submit to the Jito bundle endpoint
- persist each bundle submission record
- write per-submission bundle logs for inspection

Why it matters:

- submission timing strongly affects success probability
- the system needs a traceable record of each dispatch attempt

### 6. Lifecycle tracking layer

Every payment flows through a lifecycle state machine.

State flow:

- QUEUED
- SUBMITTED
- PROCESSED
- CONFIRMED
- FINALIZED
- FAILED
- ABANDONED

Responsibilities:

- track state transitions across the full journey
- capture slot and timestamp information for each step
- compute latency deltas between lifecycle stages
- persist the path for later verification

Why it matters:

- the bounty explicitly requires lifecycle evidence
- this is how the system becomes auditable and explainable

### 7. Confirmation listener

The confirmation listener watches transaction signatures on the Geyser stream.

Responsibilities:

- watch specific signatures emitted by submitted bundles
- detect confirmation events from the stream
- transition the payment lifecycle from submitted to confirmed or failed
- avoid relying solely on RPC polling

Why it matters:

- this is a direct requirement of the bounty
- it demonstrates real stream-based monitoring rather than a simple RPC loop

### 8. Failure classification and retry layer

When a transaction fails or drops, the system classifies the failure and routes it through the AI agent.

Responsibilities:

- map raw errors to structured failure types
- classify issues such as expired blockhash, low fee, dropped bundle, leader skip, or compute budget errors
- preserve the failure event in the database
- trigger recovery logic based on the classification

Why it matters:

- failures are not just logged; they become operational input for smarter retries

### 9. AI agent layer

The AI agent is responsible for one meaningful operational decision: how to recover from a failure.

Responsibilities:

- inspect the error, current network health, recent tip statistics, and blockhash age
- decide whether to refresh the blockhash, raise the tip, wait for a new leader window, or abandon the payment
- produce structured reasoning for each decision
- ensure retries are not hardcoded and come from agent-driven reasoning

Why it matters:

- this satisfies the bounty’s requirement for an AI-assisted operational decision
- it makes the system more adaptive than a simple retry loop

### 10. Persistence and observability

The stack writes all important information to SQLite and filesystem logs.

Responsibilities:

- persist payments, submissions, lifecycle events, failures, agent decisions, and receipts
- emit bundle logs as JSON files for inspection
- support a dashboard for monitoring submissions and AI decisions

Why it matters:

- the project must demonstrate real operational behavior, not only in-memory state
- judges can verify slot numbers, submission attempts, and lifecycle transitions

---

## Data flow

1. A payment request enters the dispatcher.
2. The dispatcher validates the recipient and creates a payment record.
3. The system monitors network conditions using Geyser slot events.
4. The leader detector identifies the upcoming Jito leader window.
5. The tip calculator derives a dynamic tip from recent Jito statistics and current health.
6. The bundle constructor builds the payment and tip transactions with a recent confirmed blockhash.
7. The submission layer sends the bundle to the Jito block engine.
8. The confirmation listener watches for transaction events from the Geyser stream.
9. If a failure occurs, the classifier routes it to the AI agent.
10. The agent decides how to recover and the system resubmits with updated context.
11. A receipt is generated once the payment reaches the finalized state.

---

## Failure handling strategy

The system is designed to handle multiple failure classes explicitly.

### Retryable failures

- blockhash expired
- fee too low
- dropped bundle
- leader skipped

### Non-retryable failures

- compute budget exceeded
- simulation failure
- unknown/unsafe conditions

For retryable cases, the AI agent may recommend:

- refresh blockhash
- increase tip
- wait for the next leader window
- resubmit

This keeps recovery logic adaptive rather than hardcoded.

---

## Why the design choices matter

### Why Jito bundles?

Jito bundles provide MEV protection and a more reliable path to execution during competitive network conditions.

### Why Yellowstone/Geyser?

Geyser provides real-time slot and transaction visibility closer to validator behavior than plain RPC polling.

### Why lifecycle tracking?

A payment system needs to know what happened between submission and finalization, not just whether the final result succeeded.

### Why an AI layer?

The AI layer gives the system a meaningful decision-making mechanism for operational recovery and is a core requirement of the bounty.

---

## Operational observations the system is designed to surface

The stack is meant to answer questions like:

- how much time passes between processed and confirmed?
- how much latency appears between confirmed and finalized?
- does the network appear healthy, congested, or degraded at the time of submission?
- did a leader skip their slot, causing a bundle to be dropped?
- did a retry succeed because the agent adjusted the tip or refreshed the blockhash?

These are exactly the kinds of operational observations the bounty wants to see in a working submission.

---

## Submission-readiness summary

This project is designed to meet the bounty’s infrastructure challenge by combining:

- live network streaming
- Jito bundle submission
- lifecycle state tracking
- failure classification
- AI-assisted recovery
- persistent logs and receipts

The architecture is intentionally modular so each subsystem can be tested, debugged, and demonstrated independently.

---

## Suggested Notion layout

Use this structure in Notion:

1. Title page
2. Overview
3. Architecture diagram
4. Core components
5. Data flow
6. Failure handling
7. AI decisioning
8. Logs and receipts
9. Demo / validation plan

---

## Copy note for publishing

This document is written to be copy-pasted into Notion as a public page. If you want a stronger submission, add:

- a cover image
- a simple architecture diagram image
- screenshots of the dashboard
- a short “live demo” section with recent bundle and receipt examples
