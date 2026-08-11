# Magnus tool calling

Magnus has two real function-call paths. The built-in chat participant sends registered `prebase_*` JSON schemas to Gemini, invokes only declared VS Code native tools, and continues with structured `functionResponse` results until a bounded final answer. The custom language-model provider maps Gemini function parts to VS Code `LanguageModelToolCallPart` and accepts matching `LanguageModelToolResultPart` continuation.

Ask/Plan exclude edit and terminal tools. Tool loops are capped by `prebase.magnus.maxToolIterations`; tool results and individual native tools remain independently bounded and confirmation-gated where they mutate state.
