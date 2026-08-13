# Preserved Architecture Graph Assets

PreBase ships one active **Code Graph**. Its stable internal identifier remains
`network`, and `prebase.graph.openNetwork` is the compatible command ID for
opening it.

The Architecture Graph implementation is deliberately retained under
`graphs/src/architecture/`, `graphs/src/layouts/architecture/`, and related
analysis helpers for future product work. These are dormant reference assets:
they must not be imported by the active Code Graph service, editor, settings,
commands, onboarding, Home, Getting Started, or restored editor path.

Legacy editor state that names `architecture` is normalized to the one Code
Graph. Legacy architecture settings are inert compatibility data and are not
registered in the active Settings schema.

Before reactivating any preserved asset, introduce a separately approved
product surface, lifecycle ownership, migration behavior, and tests. Do not
silently add it back to the active Code Graph runtime.
