/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { Server as UtilityProcessServer } from '../../../../../../base/parts/ipc/node/ipc.mp.js';
import { CANONICAL_PARSER_WORKER_CHANNEL } from '../../core/canonical/canonicalParseWorkerProtocol.js';
import { CanonicalParserWorkerService } from './canonicalParserWorkerService.js';

const server = new UtilityProcessServer();
server.registerChannel(CANONICAL_PARSER_WORKER_CHANNEL, ProxyChannel.fromService(new CanonicalParserWorkerService(), new DisposableStore()));
