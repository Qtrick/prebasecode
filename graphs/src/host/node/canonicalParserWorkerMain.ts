/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Server as UtilityProcessServer } from '../../../../../../base/parts/ipc/node/ipc.mp.js';
import { CANONICAL_PARSER_WORKER_CHANNEL } from '../../core/canonical/canonicalParseWorkerProtocol.js';
import { CanonicalParserWorkerService } from './canonicalParserWorkerService.js';
import { CanonicalParserWorkerChannel } from './canonicalParserWorkerChannel.js';

const server = new UtilityProcessServer();
server.registerChannel(CANONICAL_PARSER_WORKER_CHANNEL, new CanonicalParserWorkerChannel(new CanonicalParserWorkerService()));
