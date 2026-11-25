# Audio Fallback and Companion Model Design

## Goal

Keep a generated slide deck playable when its narration audio is absent, and make the right-side companion model independently configurable. Make source-verification failures understandable and diagnosable without weakening the source checks.

## Scope

The player change is limited to the deck playback path. When a deck exists but its audio URL fails, the deck enters a local real-time reading mode: system `SpeechSynthesis` reads the deck's existing narration text while slides, captions, progress, seeking, playback rate, pause/play, and automatic next-station behavior continue using a local clock. If system speech is unavailable, the same clock keeps the deck playable visually. Existing audio playback remains the preferred path whenever audio loads.

The companion change is limited to chat model selection and error reporting. The companion keeps its own provider/model choice, independent of the generation model. The existing provider credentials remain shared by provider, while the selected chat model is stored separately. Source validation remains strict; only the internal failure reason and user-facing explanation become clearer.

## Design

`DeckPane` owns whether the current station has usable audio and chooses either the media element clock or a monotonic visual clock. The visual clock advances only while playing, clamps at the deck duration, emits the same progress callbacks, and invokes the existing `onEnded` path once. Local speech is cancelled and restarted on pause, seek, rate, and station changes. `useTransport` is extended only as needed to control a playback clock abstraction, preserving its keyboard and rate behavior.

The companion model settings expose an independent model input for the selected chat provider, alongside the existing provider selector. For catalog providers it offers the known model list plus a custom model field where appropriate; `inherit` continues to mean the generation model. Settings persistence and `resolveChatModel` already have separate chat-provider concepts, so the change must preserve that boundary and add only the missing model selection UI/state wiring.

Citation failures are classified internally by the failing validation stage (marker/evidence/reference, quote ownership, or uncited quote). The UI keeps a short localized error and offers retry through the existing composer; no citation is accepted merely to avoid an error.

## Constraints

- Do not weaken `validateCitations` or `verifyBookQuotes`.
- Do not regenerate books or modify deck data when audio is missing.
- Do not change generation provider/model selection when changing the companion model.
- Do not send new data off the machine.
- Preserve English and Chinese product copy through the existing dictionaries.

## Verification

1. Add a focused visual-clock regression test for a deck with a missing audio source.
2. Add settings/model tests proving chat model selection is independent from generation selection.
3. Add companion validation tests proving diagnostic failure codes preserve rejection.
4. Run `bun test`, `bun run typecheck`, and `cd apps/desktop && bun run build`.
5. Verify the real Electrobun shell with a deck whose audio file is absent, then verify the right-side model input and a failed citation message.

