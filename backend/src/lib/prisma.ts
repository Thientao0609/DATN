import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Client dùng được cả ngoài và trong transaction. */
export type Db = Prisma.TransactionClient;
