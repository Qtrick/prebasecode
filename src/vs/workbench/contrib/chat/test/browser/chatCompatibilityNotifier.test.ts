/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatCompatibilityNotifier } from '../../browser/chatParticipant.contribution.js';
import { ExtensionRuntimeActionType, IExtension, IExtensionsNotification, IExtensionsWorkbenchService } from '../../../extensions/common/extensions.js';
import { EnablementState } from '../../../../services/extensionManagement/common/extensionManagement.js';

class MockExtensionsWorkbenchService implements Partial<IExtensionsWorkbenchService> {
	private readonly _onChange = new Emitter<IExtension | undefined>();
	readonly onChange: Event<IExtension | undefined> = this._onChange.event;

	private readonly _onDidChangeExtensionsNotification = new Emitter<IExtensionsNotification | undefined>();
	readonly onDidChangeExtensionsNotification: Event<IExtensionsNotification | undefined> = this._onDidChangeExtensionsNotification.event;

	local: IExtension[] = [];
	private _notification: IExtensionsNotification | undefined;

	getExtensionsNotification(): IExtensionsNotification | undefined {
		return this._notification;
	}

	setNotification(notification: IExtensionsNotification | undefined): void {
		this._notification = notification;
		this._onDidChangeExtensionsNotification.fire(notification);
	}

	fireChange(ext?: IExtension): void {
		this._onChange.fire(ext);
	}

	dispose(): void {
		this._onChange.dispose();
		this._onDidChangeExtensionsNotification.dispose();
	}
}

function createMockExtension(opts: {
	id: string;
	version?: string;
	enablementState?: EnablementState;
	isValid?: boolean;
	runtimeAction?: ExtensionRuntimeActionType;
}): IExtension {
	return {
		identifier: { id: opts.id, uuid: undefined },
		version: opts.version ?? '0.1.0',
		enablementState: opts.enablementState ?? EnablementState.EnabledGlobally,
		runtimeState: opts.runtimeAction ? { action: opts.runtimeAction, reason: 'test' } : undefined,
		local: {
			isValid: opts.isValid ?? true,
			identifier: { id: opts.id },
			manifest: { name: opts.id, version: opts.version ?? '0.1.0', engines: { vscode: '^1.90.0' }, publisher: 'prebase' },
		} as any,
	} as any;
}

suite('ChatCompatibilityNotifier', () => {
	const disposables = new DisposableStore();

	teardown(() => {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps chatExtensionInvalid false for healthy Magnus', () => {
		const configService = new TestConfigurationService();
		const contextKeyService = disposables.add(new ContextKeyService(configService));
		const extensionsService = disposables.add(new MockExtensionsWorkbenchService());

		const productService: Partial<IProductService> = {
			nameLong: 'PreBase',
			defaultChatAgent: {
				extensionId: 'prebase.magnus',
				chatExtensionId: 'prebase.magnus',
				name: 'Magnus',
			} as any,
		};

		const magnus = createMockExtension({ id: 'prebase.magnus', version: '0.1.0' });
		extensionsService.local = [magnus];

		disposables.add(new ChatCompatibilityNotifier(
			extensionsService as any,
			contextKeyService,
			productService as any,
		));

		assert.strictEqual(contextKeyService.getContextKeyValue(ChatContextKeys.extensionInvalid.key), false);
	});

	test('does not set chatExtensionInvalid for reload-required or restart-required notifications', () => {
		const configService = new TestConfigurationService();
		const contextKeyService = disposables.add(new ContextKeyService(configService));
		const extensionsService = disposables.add(new MockExtensionsWorkbenchService());

		const productService: Partial<IProductService> = {
			nameLong: 'PreBase',
			defaultChatAgent: {
				extensionId: 'prebase.magnus',
				chatExtensionId: 'prebase.magnus',
				name: 'Magnus',
			} as any,
		};

		const magnusReload = createMockExtension({
			id: 'prebase.magnus',
			version: '0.1.0',
			runtimeAction: ExtensionRuntimeActionType.ReloadWindow,
		});
		extensionsService.local = [magnusReload];

		disposables.add(new ChatCompatibilityNotifier(
			extensionsService as any,
			contextKeyService,
			productService as any,
		));

		// Magnus appears in reload notification
		extensionsService.setNotification({
			message: 'Extensions require a window reload to apply updates.',
			severity: 1,
			extensions: [magnusReload],
		});

		assert.strictEqual(contextKeyService.getContextKeyValue(ChatContextKeys.extensionInvalid.key), false);

		// Magnus appears in restart notification
		const magnusRestart = createMockExtension({
			id: 'prebase.magnus',
			version: '0.1.0',
			runtimeAction: ExtensionRuntimeActionType.RestartExtensions,
		});
		extensionsService.local = [magnusRestart];
		extensionsService.setNotification({
			message: 'All extensions require a restart to apply updates.',
			severity: 1,
			extensions: [magnusRestart],
		});

		assert.strictEqual(contextKeyService.getContextKeyValue(ChatContextKeys.extensionInvalid.key), false);
	});

	test('sets chatExtensionInvalid true when default chat extension is DisabledByInvalidExtension', () => {
		const configService = new TestConfigurationService();
		const contextKeyService = disposables.add(new ContextKeyService(configService));
		const extensionsService = disposables.add(new MockExtensionsWorkbenchService());

		const productService: Partial<IProductService> = {
			nameLong: 'PreBase',
			defaultChatAgent: {
				extensionId: 'prebase.magnus',
				chatExtensionId: 'prebase.magnus',
				name: 'Magnus',
			} as any,
		};

		const invalidMagnus = createMockExtension({
			id: 'prebase.magnus',
			version: '0.1.0',
			enablementState: EnablementState.DisabledByInvalidExtension,
		});
		extensionsService.local = [invalidMagnus];

		disposables.add(new ChatCompatibilityNotifier(
			extensionsService as any,
			contextKeyService,
			productService as any,
		));

		assert.strictEqual(contextKeyService.getContextKeyValue(ChatContextKeys.extensionInvalid.key), true);
	});

	test('ignores invalid state of unrelated extensions', () => {
		const configService = new TestConfigurationService();
		const contextKeyService = disposables.add(new ContextKeyService(configService));
		const extensionsService = disposables.add(new MockExtensionsWorkbenchService());

		const productService: Partial<IProductService> = {
			nameLong: 'PreBase',
			defaultChatAgent: {
				extensionId: 'prebase.magnus',
				chatExtensionId: 'prebase.magnus',
				name: 'Magnus',
			} as any,
		};

		const healthyMagnus = createMockExtension({ id: 'prebase.magnus' });
		const unrelatedInvalid = createMockExtension({
			id: 'publisher.other-extension',
			enablementState: EnablementState.DisabledByInvalidExtension,
		});
		extensionsService.local = [healthyMagnus, unrelatedInvalid];

		disposables.add(new ChatCompatibilityNotifier(
			extensionsService as any,
			contextKeyService,
			productService as any,
		));

		assert.strictEqual(contextKeyService.getContextKeyValue(ChatContextKeys.extensionInvalid.key), false);
	});
});
