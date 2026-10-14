import type { ConnectRouter } from '@connectrpc/connect';
import type { Account, StudyEngine } from '@mon/core';
import { pb } from '@mon/api';
import type { Accounts } from '../accounts.ts';
import { authService } from './auth.ts';
import { studyService } from './study.ts';

export interface ConnectRoutesOptions {
  accounts: Accounts;
  engineFor(account: Account): Promise<StudyEngine>;
}

/**
 * Both services, on one router.
 *
 * Connect serves this same `.proto` over three protocols from one process:
 * binary gRPC over HTTP/2 for the phones, gRPC-Web for anything behind a proxy
 * that insists, and Connect's own HTTP/POST-with-JSON — which is what the
 * browser can call without a translating sidecar, and what `curl` can call
 * during an incident.
 *
 * ```
 * curl -X POST http://localhost:8787/mon.v1.AuthService/SignIn \
 *   -H 'Content-Type: application/json' \
 *   -d '{"email":"a@example.com","password":"correct horse"}'
 * ```
 *
 * That the debugging path and the shipping path are the same bytes-on-the-wire
 * contract is most of the reason Connect was chosen over raw gRPC.
 */
export function connectRoutes(options: ConnectRoutesOptions) {
  return (router: ConnectRouter) => {
    router.service(pb.AuthService, authService(options.accounts));
    router.service(
      pb.StudyService,
      studyService({
        verify: (token) => options.accounts.verify(token),
        engineFor: options.engineFor,
      }),
    );
  };
}
