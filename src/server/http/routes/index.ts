// Every HTTP route the office answers, in the order they're tried: a new route goes where it has to
// come in that order (see http/router.ts). The public ones are tried first, then the sign-in check,
// then the rest; the last one answers every path left with the client bundle, or a 404.
import type { Route } from '../router.js';
import { agentRoutes } from './agents.js';
import { authRoutes } from './auth.js';
import { fileRoutes } from './files.js';
import { githubRoutes } from './github.js';
import { pageRoutes } from './pages.js';
import { searchRoutes } from './search.js';
import { serviceRoutes } from './services.js';
import { bridgeRoutes } from './bridge.js';
import { kaviSendRoutes } from './kavi-send.js';
import { hqBriefRoutes } from './hq-brief.js';
import { officeRoutes } from './office.js';
import { hqRoutes } from './hq.js';
import { poolRoutes } from './pool.js';
import { liveRoutes } from './live.js';

export const routes: readonly Route[] = [
  // Anyone.
  authRoutes.login,
  authRoutes.loginOptions,
  authRoutes.join,
  authRoutes.claimable,
  authRoutes.claim,
  authRoutes.link,
  authRoutes.logout,
  pageRoutes.health,
  bridgeRoutes.chatRecent,
  bridgeRoutes.say,
  bridgeRoutes.inbox,
  bridgeRoutes.crewStatus,
  bridgeRoutes.crewStatusGet,
  bridgeRoutes.status,
  hqRoutes.roster,
  hqRoutes.talk,
  hqRoutes.talkGet,
  hqRoutes.desk,
  hqRoutes.deskGet,
  hqRoutes.okkinModel,
  hqRoutes.okkinLoft,
  hqRoutes.okkinPower,
  hqRoutes.status,
  bridgeRoutes.kaviFeed,
  bridgeRoutes.kaviFeedGet,
  bridgeRoutes.kaviOutbox,
  bridgeRoutes.kaviOutboxGet,
  liveRoutes.push,
  liveRoutes.seats,
  liveRoutes.toggle,
  liveRoutes.frame,
  bridgeRoutes.kaviDesk,
  kaviSendRoutes.bridge,
  kaviSendRoutes.thread,
  kaviSendRoutes.message,
  kaviSendRoutes.file,
  hqBriefRoutes.brief,
  hqBriefRoutes.seen,
  hqBriefRoutes.needs,
  hqBriefRoutes.board,
  poolRoutes.list,
  poolRoutes.post,
  poolRoutes.claim,
  poolRoutes.heartbeat,
  poolRoutes.release,
  poolRoutes.complete,
  poolRoutes.pull,
  poolRoutes.danPass,
  poolRoutes.job,
  pageRoutes.assets,
  pageRoutes.login,
  pageRoutes.claim,
  pageRoutes.join,
  pageRoutes.favicon,
  // Signed in. The unblock answer is a person at the office, never a bridge token.
  hqBriefRoutes.answer,
  authRoutes.whoami,
  officeRoutes.state,
  officeRoutes.sinceClose,
  officeRoutes.dismiss,
  officeRoutes.close,
  poolRoutes.callers,
  poolRoutes.ownerApproval,
  agentRoutes.models,
  fileRoutes.image,
  fileRoutes.whiteboardFile,
  fileRoutes.termDrop,
  fileRoutes.changedFile,
  fileRoutes.docs,
  searchRoutes.search,
  serviceRoutes.forwards,
  githubRoutes.github,
  pageRoutes.office,
  pageRoutes.lite,
  pageRoutes.bundle,
];
