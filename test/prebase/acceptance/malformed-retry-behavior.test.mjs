/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Source contract tests for malformed response retry behavior in the AI agent.
 *
 * The chatParticipant.ts handles malformed responses from AI providers by
 * automatically retrying once before surfacing an error. This prevents
 * transient provider issues from immediately failing the user's request.
 *
 * Retry flow:
 * 1. Malformed response detected (disposition === 'malformed')
 * 2. If retryable (not last iteration): clear rawText, continue loop
 * 3. If not retryable (last iteration): surface concise error message
 *
 * Error messages are concise and actionable:
 * - Malformed: "Check your API key, ensure the model is available in your region, or select a different model."
 * - Empty stop: "The model returned an empty response, possibly due to rate limiting or safety filtering."
 * - Starvation: "The model exhausted its output budget during reasoning."
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const chatParticipantPath = resolve(repoRoot, 'extensions/prebase-magnus/src/chatParticipant.ts');

if (!existsSync(chatParticipantPath)) {
	throw new Error(`chatParticipant.ts not found at ${chatParticipantPath}`);
}

const chatParticipant = readFileSync(chatParticipantPath, 'utf8');

test('malformed response gets one automatic retry before error', () => {
	// BEHAVIOR: When the AI provider returns a malformed response, the agent
	// must automatically retry once before surfacing an error. This handles
	// transient provider issues (e.g., partial JSON, truncated SSE).
	//
	// WHY OLD CODE FAILS: If the old code immediately threw on malformed,
	// every transient provider glitch would fail the user's request.
	const malformedBlock = chatParticipant.slice(
		chatParticipant.indexOf("result.disposition === 'malformed'"),
		chatParticipant.indexOf("result.disposition === 'malformed'") + 400,
	);

	// Must check if retryable (not last iteration)
	assert.match(malformedBlock, /isRetryable/,
		'malformed handler must check if the response is retryable');

	// Must continue the loop (retry) when retryable
	assert.match(malformedBlock, /rawText = '';\s*\n\s*continue;/,
		'malformed retry must clear rawText and continue the loop');

	// Must NOT throw immediately on malformed
	assert.doesNotMatch(malformedBlock, /throw new Error/,
		'malformed handler must not throw — it must retry or surface a message');
});

test('malformed retry is bounded by maxProviderRounds', () => {
	// BEHAVIOR: The malformed retry must not loop forever. It must respect
	// the maxProviderRounds budget and stop retrying when at the limit.
	//
	// WHY OLD CODE FAILS: Without a bound, a persistently malformed provider
	// could loop indefinitely, hanging the request.
	const malformedBlock = chatParticipant.slice(
		chatParticipant.indexOf("result.disposition === 'malformed'"),
		chatParticipant.indexOf("result.disposition === 'malformed'") + 400,
	);

	assert.match(malformedBlock, /iteration < assembled\.budget\.maxProviderRounds - 1/,
		'malformed retry must check against maxProviderRounds budget');
});

test('malformed error message is concise and actionable', () => {
	// BEHAVIOR: When the malformed response is not retryable (last iteration),
	// the error message must be concise and tell the user what to do:
	// check API key, ensure model availability, or select a different model.
	//
	// WHY OLD CODE FAILS: A vague error like "Invalid response" gives the user
	// no actionable path forward. The message must guide recovery.
	const malformedBlock = chatParticipant.slice(
		chatParticipant.indexOf("result.disposition === 'malformed'"),
		chatParticipant.indexOf("result.disposition === 'malformed'") + 600,
	);

	assert.match(malformedBlock, /Check your API key/,
		'error must mention checking the API key');
	assert.match(malformedBlock, /ensure the model is available in your region/,
		'error must mention model regional availability');
	assert.match(malformedBlock, /select a different model/,
		'error must suggest selecting a different model');
	// Message must be under 200 chars for concise display
	const msgMatch = malformedBlock.match(/rawText = '([^']+)'/);
	assert.ok(msgMatch, 'must have a rawText error message');
	assert.ok(msgMatch[1].length < 200,
		`error message must be concise (got ${msgMatch[1].length} chars, max 200)`);
});

test('empty stop before tool execution retries the full request (not just recovery)', () => {
	// BEHAVIOR: When the model returns empty stop BEFORE any tool execution,
	// the agent must retry the full request (same system instruction, same model)
	// rather than just attempting a recovery summary. This handles transient
	// provider issues where the first response is empty.
	//
	// WHY OLD CODE FAILS: If empty stop before tools immediately showed an error,
	// transient provider glitches would unnecessarily fail the request.

	// Verify the else branch exists (handles !enteredRunning case)
	assert.match(chatParticipant, /} else \{\s*try \{\s*const retryResult = await streamPacedCandidate/,
		'empty stop before tools must have an else branch that retries');

	// Verify the retry uses the original system instruction (not a recovery summary instruction)
	const emptyStopIdx = chatParticipant.indexOf("result.disposition === 'emptyStop'");
	const elseBranchStart = chatParticipant.indexOf('} else {', emptyStopIdx);
	const elseBranch = chatParticipant.slice(elseBranchStart, elseBranchStart + 500);
	assert.match(elseBranch, /systemInstruction: assembled\.systemInstruction/,
		'empty stop retry must use original system instruction, not a recovery instruction');
});

test('starvation recovery uses low reasoning effort to force a visible response', () => {
	// BEHAVIOR: When the model exhausts its output budget during reasoning
	// (thoughtOnly or maxTokens), the recovery attempt must use low reasoning
	// effort to force the model to produce visible output instead of more thinking.
	//
	// WHY OLD CODE FAILS: Without lowering reasoning effort, the recovery
	// attempt might also exhaust its budget on more thinking.
	const starvationBlock = chatParticipant.slice(
		chatParticipant.indexOf("result.disposition === 'thoughtOnly' || result.disposition === 'maxTokens'"),
		chatParticipant.indexOf("result.disposition === 'thoughtOnly' || result.disposition === 'maxTokens'") + 800,
	);

	assert.match(starvationBlock, /reasoningEffort:\s*'low'/,
		'starvation recovery must use low reasoning effort');
	assert.match(starvationBlock, /Synthesize and provide your final user-facing response now/,
		'starvation recovery prompt must instruct the model to produce final output');
	assert.match(starvationBlock, /Do not call additional tools/,
		'starvation recovery must prevent additional tool calls');
});

test('each error type has a distinct, actionable error message', () => {
	// BEHAVIOR: Each error disposition must produce a unique error message
	// that tells the user specifically what happened and what to do about it.
	// This helps users self-diagnose provider issues.
	//
	// WHY OLD CODE FAILS: Generic error messages like "Something went wrong"
	// give users no path to resolution.
	const errorMessages = [
		{
			disposition: 'malformed',
			pattern: /unparseable response/,
			action: /Check your API key/,
		},
		{
			disposition: 'emptyStop',
			pattern: /empty response/,
			action: /rate limiting or safety filtering/,
		},
		{
			disposition: 'thoughtOnly/maxTokens',
			pattern: /exhausted its output budget/,
			action: /lower reasoning level/,
		},
		{
			disposition: 'promptBlocked',
			pattern: /blocked by.*safety policy/,
			action: /adjust your prompt/,
		},
		{
			disposition: 'candidateBlocked',
			pattern: /blocked by safety policy/,
			action: /rephrase or narrow/,
		},
	];

	for (const { disposition, pattern, action } of errorMessages) {
		const hasPattern = pattern.test(chatParticipant);
		const hasAction = action.test(chatParticipant);
		assert.ok(hasPattern, `${disposition} error must describe what happened`);
		assert.ok(hasAction, `${disposition} error must tell user what to do`);
	}
});

test('recovery attempts are one-shot (recoveredStarvation and recoveredEmptyStop flags)', () => {
	// BEHAVIOR: Recovery from starvation and empty stop must be one-shot.
	// The flags recoveredStarvation and recoveredEmptyStop prevent infinite
	// retry loops when the model consistently fails.
	//
	// WHY OLD CODE FAILS: Without one-shot flags, a persistently failing
	// model could loop forever in recovery attempts.
	assert.match(chatParticipant, /let recoveredStarvation = false/,
		'must have a recoveredStarvation flag');
	assert.match(chatParticipant, /let recoveredEmptyStop = false/,
		'must have a recoveredEmptyStop flag');
	assert.match(chatParticipant, /!recoveredStarvation/,
		'must check recoveredStarvation before retrying starvation');
	assert.match(chatParticipant, /!recoveredEmptyStop/,
		'must check recoveredEmptyStop before retrying empty stop');
	assert.match(chatParticipant, /recoveredStarvation = true/,
		'must set recoveredStarvation after first attempt');
	assert.match(chatParticipant, /recoveredEmptyStop = true/,
		'must set recoveredEmptyStop after first attempt');
});
