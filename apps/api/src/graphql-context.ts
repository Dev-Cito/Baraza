import type { Request } from 'express';
import type { Loaders } from './loaders/loaders.service';

export interface GraphQLContext {
  req: Request;
  // Fresh per request; see LoadersService.
  loaders: Loaders;
}
