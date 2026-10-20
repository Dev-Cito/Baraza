import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { AppModule } from './../src/app.module';

export interface GqlError {
  message: string;
  extensions?: { code?: string };
}

export interface GqlResponse<T> {
  data?: T | null;
  errors?: GqlError[];
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  token: string;
}

// Boots the full app on a random port.
export async function startApp(): Promise<{
  app: INestApplication;
  host: string;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return { app, host: `localhost:${port}/graphql` };
}

export async function gql<T>(
  host: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<GqlResponse<T>> {
  const res = await fetch(`http://${host}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as GqlResponse<T>;
}

const REGISTER = /* GraphQL */ `
  mutation ($input: RegisterInput!) {
    register(input: $input) {
      token
      user {
        id
        username
      }
    }
  }
`;

const LOGIN = /* GraphQL */ `
  mutation ($input: LoginInput!) {
    login(input: $input) {
      token
      user {
        id
      }
    }
  }
`;

interface AuthResult {
  token: string;
  user: { id: string; username: string };
}

// Registers a fresh user, then logs in to get the token the tests will use.
export async function registerAndLogin(
  host: string,
  username: string,
): Promise<TestUser> {
  const email = `${username}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const registered = await gql<{ register: AuthResult }>(host, REGISTER, {
    input: { email, username, password },
  });
  if (!registered.data) throw new Error(JSON.stringify(registered.errors));
  const loggedIn = await gql<{ login: AuthResult }>(host, LOGIN, {
    input: { email, password },
  });
  if (!loggedIn.data) throw new Error(JSON.stringify(loggedIn.errors));
  return {
    id: registered.data.register.user.id,
    email,
    username,
    password,
    token: loggedIn.data.login.token,
  };
}

// graphql-ws client; the token goes in connectionParams at the handshake.
// Pass connectionParams to send something else verbatim.
export function wsClient(
  host: string,
  token?: string,
  connectionParams?: Record<string, unknown>,
): Client {
  return createClient({
    url: `ws://${host}`,
    webSocketImpl: WebSocket,
    connectionParams:
      connectionParams ?? (token ? { authorization: `Bearer ${token}` } : {}),
    retryAttempts: 0,
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
