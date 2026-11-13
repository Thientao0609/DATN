-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `cancelReason` TEXT NULL,
    ADD COLUMN `changeReason` TEXT NULL,
    ADD COLUMN `changeRejectReason` TEXT NULL,
    ADD COLUMN `changeRejectedAt` DATETIME(3) NULL,
    ADD COLUMN `previousStartTime` DATETIME(3) NULL,
    ADD COLUMN `rejectedStartTime` DATETIME(3) NULL,
    ADD COLUMN `rescheduleOfId` VARCHAR(191) NULL,
    MODIFY `status` ENUM('CONFIRMED', 'CANCELLED', 'COMPLETED', 'PENDING') NOT NULL DEFAULT 'CONFIRMED';

-- CreateIndex
CREATE UNIQUE INDEX `appointments_rescheduleOfId_key` ON `appointments`(`rescheduleOfId`);

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_rescheduleOfId_fkey` FOREIGN KEY (`rescheduleOfId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

