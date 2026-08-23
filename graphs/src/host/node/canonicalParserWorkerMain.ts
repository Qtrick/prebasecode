/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Server as ChildProcessServer } from '../../../../../../base/parts/ipc/node/ipc.cp.js';
import { Server as UtilityProcessServer } from '../../../../../../base/parts/ipc/node/ipc.mp.js';
import { isUtilityProcess } from '../../../../../../base/parts/sandbox/node/electronTypes.js';
import { CANONICAL_PARSER_WORKER_CHANNEL } from '../../core/canonical/canonicalParseWorkerProtocol.js';
import { CanonicalParserWorkerService } from './canonicalParserWorkerService.js';
import { CanonicalParserWorkerChannel } from './canonicalParserWorkerChannel.js';

let server: ChildProcessServer<string> | UtilityProcessServer;
if (isUtilityProcess(process)) {
	server = new UtilityProcessServer();
} else {
	server = new ChildProcessServer('prebaseCanonicalParser');
}

server.registerChannel(CANONICAL_PARSER_WORKER_CHANNEL, new CanonicalParserWorkerChannel(new CanonicalParserWorkerService()));
