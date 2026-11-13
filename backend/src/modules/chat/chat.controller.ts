import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { idParamsSchema } from '../../lib/validation.js';
import { currentUser } from '../../middleware/auth.js';
import { runAgentTurn } from './agent.js';
import { createSessionSchema, sendMessageSchema } from './chat.schema.js';
import * as chatService from './chat.service.js';

export async function createSession(req: Request, res: Response) {
  const { title } = createSessionSchema.parse(req.body ?? {});
  res.status(201).json({ session: await chatService.createSession(currentUser(req).id, title) });
}

export async function listSessions(req: Request, res: Response) {
  res.json({ sessions: await chatService.listSessions(currentUser(req).id) });
}

export async function listMessages(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const session = await chatService.getOwnedSession(currentUser(req).id, id);
  const [messages, pendingAction] = await Promise.all([
    chatService.listVisibleMessages(session.id),
    chatService.currentPendingAction(session.id),
  ]);
  res.json({ messages, pendingAction });
}

export async function sendMessage(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const { content } = sendMessageSchema.parse(req.body);
  const auth = currentUser(req);
  const session = await chatService.getOwnedSession(auth.id, id);
  const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { id: true, fullName: true } });
  if (!user) throw new AppError('UNAUTHORIZED', 'Tài khoản không còn tồn tại, vui lòng đăng nhập lại.');
  await chatService.maybeSetTitleFromMessage(session.id, session.title, content);
  res.json(await runAgentTurn({ sessionId: session.id, user, content }));
}

export async function confirmAction(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await chatService.confirmPendingAction(currentUser(req).id, id));
}

export async function rejectAction(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json(await chatService.rejectPendingAction(currentUser(req).id, id));
}
