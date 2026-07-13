# Aegis Product Presentation — Production Brief

## Style Block

No `design.md` exists, so this follows the HyperFrames house-style path.

- Palette: background `#090B0A`, panel `#111612`, foreground `#F2EEE5`, muted `#A9B2A8`, shield amber `#D9A441`, verification green `#60D394`, danger red `#E86D5C`, line `#2C352C`.
- Typography: display serif `"Fraunces"`, body/labels mono `"IBM Plex Mono"`. The contrast is deliberate: a mythic shield/product name against exact authorization machinery.
- Mood: cinematic enterprise ChatGPT pitch, built for a startup-weekend demo room. Protective, exacting, high trust.
- Format: 1920x1080, 48 seconds, six scenes.

## Rhythm Declaration

`hook-PUNCH-build-PEAK-proof-CTA`

The first two scenes make the risk visceral. The middle scenes show the core architectural answer. The final two scenes turn it into a Startup Weekend product pitch with founder attribution.

## Global Rules

- Every scene has a dark textured background, at least two focal points, and micro-details: grid lines, tuple labels, trace IDs, status badges, or connector marks.
- Primary transition: amber shield-wipe cover, 0.5s, `power3.inOut`.
- Accent transition: scanner line / access pulse during the enforcement scene.
- All motion is deterministic GSAP on one paused root timeline registered as `window.__timelines["aegis-product-presentation"]`.
- No live fetches, Date, random, or async timeline construction.

## Scene Beats

### 1. Aegis Hook

Concept: The viewer enters a dark operations room where a shield is already awake. Aegis is introduced as ChatGPT for your company knowledge, with the permissions enterprises require. Security is not a back-office feature; it is the reason this assistant can exist.

Depth layers: radial shield glow, faint grid, ghost word `AEGIS`, founder/stage metadata, central shield mark, tagline, three capability chips.

Choreography: shield STAMPS in, ghost title DRIFTS, tagline SLIDES, chips CASCADE, metadata TYPES into place.

Transition out: shield-wipe from right to left, covering the frame with amber before revealing the risk scene.

### 2. The Leak Problem

Concept: A naive enterprise RAG system retrieves the most relevant chunks before knowing who is asking. The frame shows confidential docs trying to enter a model context, then highlights the leak.

Depth layers: red risk glow, document cards, user query box, model context zone, warning strip, denied/allowed signals.

Choreography: document cards DROP into the retrieval lane, red leak line PULSES, warning text SLAMS, query panel LOCKS into place.

Transition out: same shield-wipe, now from the leak line into a controlled two-plane diagram.

### 3. Two-Plane Architecture

Concept: Aegis separates semantic relevance from authorization. Retrieval can find candidates, but OpenFGA decides which documents are even allowed to touch the answer.

Depth layers: split frame with Authz Plane and Retrieval Plane, vector nodes, OpenFGA gate, connector labels, NATS event thread, Postgres/pgvector module.

Choreography: planes DRAW as structural rules, nodes CASCADE, NATS event bead TRAVELS, gate ILLUMINATES, label stack TYPES.

Transition out: gate pulse expands to fill the screen, carrying us into query-time enforcement.

### 4. Query-Time Enforcement

Concept: A user asks a real question. Aegis over-fetches or list-filters, then BatchChecks/ListObjects through OpenFGA before the LLM receives anything. Unauthorized candidates are visibly dropped.

Depth layers: query prompt, candidate list, authorization decision rail, LLM context, citations, "0 unauthorized chunks" score.

Choreography: query SLIDES in, candidates COUNT/RANK, checks FLASH green/red, denied rows collapse sideways, authorized context SEALS around the LLM.

Transition out: green check pulse wipes to the proof scene.

### 5. Startup Weekend Build Proof

Concept: AIBoomi Startup Weekend energy: this is not just a concept, it has a working skeleton and test backbone. The frame presents the implementation modules and tests as a launch board.

Depth layers: weekend badge, module stack, test counters, vertical slice milestones, source-agnostic connector lane, scale targets.

Choreography: module tiles CASCADE, counters POP, milestones DRAW, scale numbers COUNT into focus.

Transition out: board compresses into the Aegis shield for the closing ask.

### 6. CTA / Founder

Concept: The pitch resolves on a simple category and attribution. The viewer should remember Aegis as enterprise ChatGPT that respects source permissions, and who built it.

Depth layers: large Aegis mark, tagline, founder line, email, three closing promises, warm closing glow.

Choreography: shield RISES, tagline FLOATS, promises CASCADE, founder attribution TYPES, final frame fades to black.

## Recurring Motifs

- Shield geometry: central mark, transition cover, access gate.
- Tuple labels: `viewer`, `parent`, `tenant`, `can_read`.
- Event line: connector to NATS to ingestion worker.
- Decision rail: green allowed, red denied, muted dropped.

## Negative Prompt

Avoid generic SaaS blue/purple gradients, generic card grids, default web UI scale, and claims not present in the Aegis materials. Do not imply production deployment; frame it as a ChatGPT-for-enterprise product created for AIBoomi Startup Weekend with a working architectural backbone.
