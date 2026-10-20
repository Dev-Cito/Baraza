import type { IncomingMessage } from 'node:http';
import type { Loaders } from './loaders/loaders.service';

export interface GraphQLContext {
  // HTTP: the Express request. WebSocket: the HTTP upgrade request.
  req: IncomingMessage;
  // WebSocket only: payload of the connection_init message, where clients send
  // credentials (browsers cannot set headers on a WebSocket).
  connectionParams?: Readonly<Record<string, unknown>>;
  // Never shared across operations; see LoadersService and AppModule.
  loaders: Loaders;
}
